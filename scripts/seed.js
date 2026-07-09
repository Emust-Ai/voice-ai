import pg from 'pg';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const pool = new pg.Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'ev24_supervisor',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

async function seed() {
  try {
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

    await pool.query(migration);
    console.log('Tables created');

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', ['admin@ev24.com']);
    if (existing.rows.length === 0) {
      const passwordHash = await bcrypt.hash('admin123', 12);
      await pool.query(
        `INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4)`,
        ['admin@ev24.com', passwordHash, 'Admin', 'admin']
      );
      console.log('Admin user created: admin@ev24.com / admin123');
    } else {
      console.log('Admin user already exists');
    }

    await pool.end();
    console.log('Seed complete');
  } catch (err) {
    console.error('Seed failed:', err.message);
    await pool.end();
    process.exit(1);
  }
}

seed();
