import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'ev24_supervisor',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err);
});

export async function query(text, params) {
  const start = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;
  if (duration > 1000) console.warn(`Slow query (${duration}ms):`, text.substring(0, 100));
  return result;
}

export async function runMigrations() {
  const migration = `
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'agent' CHECK (role IN ('admin', 'supervisor', 'agent')),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id SERIAL PRIMARY KEY,
    external_id VARCHAR(255) UNIQUE,
    channel VARCHAR(50) NOT NULL DEFAULT 'voice' CHECK (channel IN ('voice', 'chat')),
    status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'ended')),
    caller_number VARCHAR(50),
    caller_name VARCHAR(255),
    tenant VARCHAR(255),
    ai_enabled BOOLEAN DEFAULT true,
    supervisor_id INTEGER REFERENCES users(id),
    metadata JSONB DEFAULT '{}',
    started_at TIMESTAMPTZ DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'supervisor')),
    content TEXT NOT NULL,
    content_type VARCHAR(50) DEFAULT 'text',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS scorecards (
    id SERIAL PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    ai_performance_score DECIMAL(5,2),
    sentiment_arc JSONB DEFAULT '[]',
    resolution_status VARCHAR(50) CHECK (resolution_status IN ('resolved', 'escalated', 'abandoned', 'unresolved')),
    flags JSONB DEFAULT '[]',
    escalation_needed BOOLEAN DEFAULT false,
    exchange_count INTEGER DEFAULT 0,
    duration_seconds INTEGER DEFAULT 0,
    tools_used JSONB DEFAULT '[]',
    summary TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS supervisor_events (
    id SERIAL PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    supervisor_id INTEGER REFERENCES users(id),
    event_type VARCHAR(50) NOT NULL CHECK (event_type IN ('barge_in', 'toggle_ai', 'inject_message', 'takeover', 'release')),
    payload JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status);
  CREATE INDEX IF NOT EXISTS idx_conversations_external ON conversations(external_id);
  CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
  CREATE INDEX IF NOT EXISTS idx_scorecards_conversation ON scorecards(conversation_id);
  CREATE INDEX IF NOT EXISTS idx_supervisor_events_conversation ON supervisor_events(conversation_id);
  `;

  try {
    await query(migration);
    console.log('Database migrations ran successfully');
  } catch (err) {
    console.error('Migration error:', err);
    throw err;
  }
}

export async function closePool() {
  await pool.end();
}
