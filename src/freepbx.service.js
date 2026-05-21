require('dotenv').config();
const AsteriskManager = require('asterisk-manager');

const AMI_PORT = Number(process.env.AMI_PORT || 5038);
const AMI_HOST = process.env.AMI_HOST || '127.0.0.1';
const AMI_USERNAME = process.env.AMI_USERNAME || 'middleware';
const AMI_PASSWORD = process.env.AMI_PASSWORD || 'ClaveSegura123';

const ami = new AsteriskManager(
  AMI_PORT,
  AMI_HOST,
  AMI_USERNAME,
  AMI_PASSWORD,
  true
);

ami.keepConnected();

const callEvents = [];
const callsByLinkedId = {};

let lastAmiEventTime = null;
let amiConnected = false;
let lastAmiError = null;

ami.on('connect', () => {
  amiConnected = true;
  lastAmiError = null;
  console.log(`✅ AMI conectado a ${AMI_HOST}:${AMI_PORT}`);
});

ami.on('disconnect', () => {
  amiConnected = false;
  console.log('⚠️ AMI desconectado');
});

ami.on('error', (err) => {
  amiConnected = false;
  lastAmiError = String(err);
  console.error('❌ Error AMI:', err);
});

ami.on('managerevent', (event) => {
  const now = new Date().toISOString();
  lastAmiEventTime = now;

  const name = String(event.event || event.Event || '').toLowerCase().trim();

  if (!['dialbegin', 'dialend', 'bridgeenter', 'hangup'].includes(name)) {
    return;
  }

  const normalized = {
    time: now,
    event: name,
    caller: event.calleridnum || event.CallerIDNum || '',
    callerName: event.calleridname || event.CallerIDName || '',
    channel: event.channel || event.Channel || '',
    destination:
      event.destination ||
      event.Destination ||
      event.dialstring ||
      event.DialString ||
      event.exten ||
      event.Exten ||
      '',
    destChannel: event.destchannel || event.DestChannel || '',
    dialStatus: event.dialstatus || event.DialStatus || '',
    bridgeUniqueid: event.bridgeuniqueid || event.BridgeUniqueid || '',
    uniqueid: event.uniqueid || event.Uniqueid || '',
    linkedid: event.linkedid || event.Linkedid || event.uniqueid || event.Uniqueid || '',
    cause: event.cause || event.Cause || '',
    causeTxt: event['cause-txt'] || event.causetxt || event.CauseTxt || ''
  };

  console.log('📞 EVENTO:', normalized);

  callEvents.push(normalized);

  if (callEvents.length > 300) {
    callEvents.shift();
  }

  updateCallSummary(normalized);
});

function updateCallSummary(ev) {
  if (!ev.linkedid) {
    return;
  }

  if (!callsByLinkedId[ev.linkedid]) {
    callsByLinkedId[ev.linkedid] = {
      linkedid: ev.linkedid,
      firstEventTime: ev.time,
      lastEventTime: ev.time,
      from: '',
      to: '',
      callerName: '',
      status: 'IN_PROGRESS',
      answered: false,
      bridged: false,
      hangupCause: '',
      hangupText: '',
      resultado: 'en progreso',
      channels: [],
      events: []
    };
  }

  const call = callsByLinkedId[ev.linkedid];

  call.lastEventTime = ev.time;

  if (ev.caller && !call.from && ev.caller !== '107' && ev.caller !== '101') {
    call.from = ev.caller;
  }

  if (!call.from && ev.caller) {
    call.from = ev.caller;
  }

  if (!call.callerName && ev.callerName) {
    call.callerName = ev.callerName;
  }

  if (!call.to) {
    if (ev.destination) {
      call.to = ev.destination;
    } else if (ev.destChannel) {
      call.to = ev.destChannel;
    }
  }

  if (ev.channel && !call.channels.includes(ev.channel)) {
    call.channels.push(ev.channel);
  }

  if (ev.destChannel && !call.channels.includes(ev.destChannel)) {
    call.channels.push(ev.destChannel);
  }

  call.events.push(ev);

  switch (ev.event) {
    case 'dialbegin':
      if (!call.from && ev.caller) {
        call.from = ev.caller;
      }
      if (!call.to && ev.destination) {
        call.to = ev.destination;
      }
      break;

    case 'dialend':
      if (ev.dialStatus) {
        call.status = ev.dialStatus;
      }
      if (ev.dialStatus === 'ANSWER') {
        call.answered = true;
      }
      break;

    case 'bridgeenter':
      call.bridged = true;
      if (call.status === 'IN_PROGRESS') {
        call.status = 'ANSWER';
      }
      break;

    case 'hangup':
      if (ev.cause) {
        call.hangupCause = ev.cause;
      }
      if (ev.causeTxt) {
        call.hangupText = ev.causeTxt;
      }
      if (!call.status || call.status === 'IN_PROGRESS') {
        call.status = 'HANGUP';
      }
      break;
  }

  call.resultado = buildCallResult(call);
}

function buildCallResult(call) {
  if (call.answered || call.bridged || call.status === 'ANSWER') {
    return 'exitosa';
  }

  if (call.status === 'BUSY') {
    return 'ocupado';
  }

  if (call.status === 'NOANSWER') {
    return 'no contestada';
  }

  if (call.status === 'CANCEL') {
    return 'cancelada';
  }

  if (call.status === 'CHANUNAVAIL') {
    return 'canal no disponible';
  }

  if (call.status === 'HANGUP') {
    return 'colgada';
  }

  return 'en progreso';
}

function getCallEvents() {
  return callEvents;
}

function getCallsSummary() {
  return Object.values(callsByLinkedId)
    .map((call) => ({
      linkedid: call.linkedid,
      firstEventTime: call.firstEventTime,
      lastEventTime: call.lastEventTime,
      from: call.from,
      to: call.to,
      callerName: call.callerName,
      status: call.status,
      answered: call.answered,
      bridged: call.bridged,
      hangupCause: call.hangupCause,
      hangupText: call.hangupText,
      resultado: call.resultado,
      channels: call.channels,
      totalEvents: call.events.length
    }))
    .sort((a, b) => new Date(b.lastEventTime) - new Date(a.lastEventTime));
}

function getCallByLinkedId(linkedid) {
  return callsByLinkedId[linkedid] || null;
}

function getAMIStatus() {
  return {
    connected: amiConnected,
    host: AMI_HOST,
    port: AMI_PORT,
    username: AMI_USERNAME,
    lastAmiEventTime,
    lastAmiError
  };
}

module.exports = {
  ami,
  getCallEvents,
  getCallsSummary,
  getCallByLinkedId,
  getAMIStatus
};
