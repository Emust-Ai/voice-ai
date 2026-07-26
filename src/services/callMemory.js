export class CallMemory {
  constructor(callSid) {
    this.callSid = callSid;
    this.exchanges = [];
    this.resolvedIntents = [];
    this.gatheredInfo = {};
    this.toolsCalled = [];
    this.language = 'fr';
    this.lastSummary = null;
    this.exchangeCount = 0;
    this.summaryInterval = 3;
  }

  addUserMessage(text) {
    this.exchanges.push({ role: 'user', text, timestamp: Date.now() });
    this.exchangeCount++;
    this._detectLanguage(text);
  }

  addAssistantMessage(text) {
    this.exchanges.push({ role: 'assistant', text, timestamp: Date.now() });
  }

  addToolCall(name, args, result) {
    this.toolsCalled.push({ name, args, timestamp: Date.now() });
    if (result?.success) {
      this._extractInfoFromTool(name, args, result);
    }
  }

  setIntent(intent) {
    if (!this.resolvedIntents.includes(intent)) {
      this.resolvedIntents.push(intent);
    }
  }

  getStateSnapshot() {
    const parts = [];

    if (this.resolvedIntents.length > 0) {
      parts.push(`Intents: ${this.resolvedIntents.join(', ')}.`);
    }

    if (Object.keys(this.gatheredInfo).length > 0) {
      const infoStr = Object.entries(this.gatheredInfo)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
      parts.push(`Known: ${infoStr}.`);
    }

    if (this.toolsCalled.length > 0) {
      const lastTools = this.toolsCalled.slice(-3).map(t => t.name).join(', ');
      parts.push(`Tools used: ${lastTools}.`);
    }

    if (this.exchanges.length > 0) {
      const lastExchange = this.exchanges[this.exchanges.length - 1];
      parts.push(`Last: ${lastExchange.role} said "${lastExchange.text.substring(0, 80)}".`);
    }

    if (this.lastSummary) {
      parts.push(`Summary: ${this.lastSummary}`);
    }

    return parts.length > 0
      ? `[SESSION STATE: ${parts.join(' ')}]`
      : null;
  }

  shouldSummarize() {
    return this.exchangeCount > 0 && this.exchangeCount % this.summaryInterval === 0;
  }

  markSummarized() {
    this.lastSummary = this._buildSummary();
  }

  getInfo(key) {
    return this.gatheredInfo[key];
  }

  setInfo(key, value) {
    if (value) this.gatheredInfo[key] = value;
  }

  _extractInfoFromTool(name, args, result) {
    switch (name) {
      case 'tenant_find':
        if (result.data?.tenant) this.gatheredInfo.tenant = result.data.tenant;
        break;
      case 'station_verification':
        if (args.station_name_or_location) this.gatheredInfo.station = args.station_name_or_location;
        if (result.data?.station_id) this.gatheredInfo.station_id = result.data.station_id;
        if (result.data?.status) this.gatheredInfo.station_status = result.data.status;
        break;
      case 'user_management':
        if (args.name) this.gatheredInfo.user_name = args.name;
        if (result.data?.user_id) this.gatheredInfo.user_id = result.data.user_id;
        break;
      case 'save_caller_info':
        if (args.caller_name) this.gatheredInfo.caller_name = args.caller_name;
        if (args.caller_phone) this.gatheredInfo.caller_phone = args.caller_phone;
        break;
      case 'remote_control':
        if (args.action) this.gatheredInfo.last_action = args.action;
        break;
      case 'generate_qr_code':
        if (args.charging_station_name) this.gatheredInfo.station = args.charging_station_name;
        if (args.connector_id) this.gatheredInfo.connector_id = args.connector_id;
        this.gatheredInfo.qr_code_sent = true;
        break;
    }
  }

  _detectLanguage(text) {
    if (/[\u0600-\u06FF]/.test(text)) {
      this.language = 'ar';
    } else if (/bonjour|salut|merci|d'accord|oui|non|pas|je|tu|il|elle|nous|vous|ils|elles|le|la|les|un|une|des|du|au|aux|est|sont|avez|être|avoir|faire|dire|aller|voir|savoir|pouvoir|vouloir|devoir|falloir/i.test(text)) {
      this.language = 'fr';
    } else if (/[a-zA-Z]/.test(text)) {
      this.language = 'en';
    }
  }

  _buildSummary() {
    const userMsgs = this.exchanges.filter(e => e.role === 'user').map(e => e.text);
    const topics = [];
    if (/charge|borne|station|branche/i.test(userMsgs.join(' '))) topics.push('charging');
    if (/factur|pay|prix|invoice/i.test(userMsgs.join(' '))) topics.push('billing');
    if (/appli|rfid|carte|badge/i.test(userMsgs.join(' '))) topics.push('auth_method');
    if (/arrêt|stop|fini/i.test(userMsgs.join(' '))) topics.push('stop_charge');
    const info = Object.keys(this.gatheredInfo).length > 0
      ? ` (${Object.entries(this.gatheredInfo).map(([k, v]) => `${k}=${v}`).join(', ')})`
      : '';
    return topics.length > 0
      ? `Caller needs help with: ${topics.join(', ')}${info}.`
      : null;
  }
}
