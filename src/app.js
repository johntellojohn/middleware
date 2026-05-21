require('dotenv').config();

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');

const {
  ami,
  getCallEvents,
  getCallsSummary,
  getCallByLinkedId,
  getAMIStatus
} = require('./freepbx.service');

const {
  speechToTextFromFile,
  askAI,
  textToSpeech
} = require('./ai-voice.service');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;

const uploadDir = path.join(__dirname, '../uploads');

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const ext = '.webm';
    cb(null, `audio-${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage
});

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(express.json());
app.use('/uploads', express.static(uploadDir));

const HUMAN_EXTENSIONS = ['107', '101'];

/* =========================================================
   BASE
========================================================= */

app.get('/', (req, res) => {
  res.send('Middleware OK 🚀');
});

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    ami: getAMIStatus()
  });
});

app.get('/call-events', (req, res) => {
  const events = getCallEvents();
  res.json({
    ok: true,
    total: events.length,
    events
  });
});

app.get('/calls-summary', (req, res) => {
  const calls = getCallsSummary();
  res.json({
    ok: true,
    total: calls.length,
    calls
  });
});

app.get('/calls-summary/:linkedid', (req, res) => {
  const call = getCallByLinkedId(req.params.linkedid);

  if (!call) {
    return res.status(404).json({
      ok: false,
      error: 'No existe ese linkedid'
    });
  }

  res.json({
    ok: true,
    call
  });
});

/* =========================================================
   FREEPBX / ASTERISK
========================================================= */

function callExtension(fromExtension, toExtension) {
  return new Promise((resolve, reject) => {
    ami.action(
      {
        Action: 'Originate',
        Channel: `PJSIP/${fromExtension}`,
        Context: 'from-internal',
        Exten: toExtension,
        Priority: 1,
        CallerID: `Ariana -> ${toExtension}`,
        Timeout: 30000,
        Async: true
      },
      (err, response) => {
        if (err) return reject(err);
        resolve(response);
      }
    );
  });
}

function callExternal(fromExtension, phoneNumber) {
  return new Promise((resolve, reject) => {
    ami.action(
      {
        Action: 'Originate',
        Channel: `PJSIP/${fromExtension}`,
        Context: 'from-internal',
        Exten: phoneNumber,
        Priority: 1,
        CallerID: `Ariana -> ${phoneNumber}`,
        Timeout: 30000,
        Async: true
      },
      (err, response) => {
        if (err) return reject(err);
        resolve(response);
      }
    );
  });
}

function callExternalDirect(phoneNumber) {
  return new Promise((resolve, reject) => {
    ami.action(
      {
        Action: 'Originate',
        Channel: `PJSIP/${phoneNumber}@fxo`,
        Application: 'Playback',
        Data: 'demo-congrats',
        CallerID: `Ariana -> ${phoneNumber}`,
        Timeout: 30000,
        Async: true
      },
      (err, response) => {
        if (err) return reject(err);
        resolve(response);
      }
    );
  });
}

async function escalateToHuman(customerWaId) {
  console.log('🔥 Escalando a humano:', customerWaId);

  for (const ext of HUMAN_EXTENSIONS) {
    try {
      console.log('📞 Intentando:', ext);

      await callExtension('101', ext);

      console.log('✅ Asignado a:', ext);

      return {
        ok: true,
        assignedExtension: ext
      };

    } catch (error) {
      console.log(`❌ Falló ${ext}:`, error.message);
    }
  }

  return {
    ok: false
  };
}

/* =========================================================
   ENDPOINTS LLAMADAS
========================================================= */

app.post('/call-external', async (req, res) => {
  const { fromExtension, phoneNumber } = req.body;

  if (!fromExtension || !phoneNumber) {
    return res.status(400).json({
      ok: false,
      error: 'fromExtension y phoneNumber requeridos'
    });
  }

  console.log(`📞 Llamada externa: ${fromExtension} → ${phoneNumber}`);

  try {
    const response = await callExternal(fromExtension, phoneNumber);

    res.json({
      ok: true,
      message: 'Llamada enviada',
      response
    });

  } catch (error) {
    console.error('❌ Error llamada externa:', error);

    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

app.post('/call-external-direct', async (req, res) => {
  const { phoneNumber } = req.body;

  if (!phoneNumber) {
    return res.status(400).json({
      ok: false,
      error: 'phoneNumber requerido'
    });
  }

  try {
    const response = await callExternalDirect(phoneNumber);

    res.json({
      ok: true,
      message: 'Llamada directa enviada',
      response
    });

  } catch (error) {
    console.error('❌ Error /call-external-direct:', error);

    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

app.post('/escalate-from-ariana-demo', async (req, res) => {
  const { customerWaId } = req.body;

  if (!customerWaId) {
    return res.status(400).json({
      ok: false,
      error: 'customerWaId requerido'
    });
  }

  console.log('🤖 Ariana pidió humano para:', customerWaId);

  const result = await escalateToHuman(customerWaId);

  if (result.ok) {
    return res.json({
      ok: true,
      assignedExtension: result.assignedExtension
    });
  }

  return res.status(500).json({
    ok: false,
    error: 'No hay agentes disponibles'
  });
});

app.post('/escalate-from-ariana', async (req, res) => {
  try {
    const { customerWaId, targetExtensions = HUMAN_EXTENSIONS } = req.body;

    if (!customerWaId) {
      return res.status(400).json({
        ok: false,
        error: 'customerWaId requerido'
      });
    }

    console.log('🤖 Ariana pidió humano para:', customerWaId);
    console.log('📋 Extensiones objetivo:', targetExtensions);

    for (const ext of targetExtensions) {
      try {
        console.log('📞 Intentando:', ext);

        await callExtension('101', ext);

        console.log('✅ Asignado a:', ext);

        return res.json({
          ok: true,
          assignedExtension: ext,
          customerWaId
        });

      } catch (error) {
        console.log(`❌ Falló ${ext}:`, error.message);
      }
    }

    return res.status(500).json({
      ok: false,
      error: 'No hay agentes disponibles'
    });

  } catch (error) {
    console.error('❌ Error en /escalate-from-ariana:', error);

    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/* =========================================================
   IA TEXTO SIMPLE
========================================================= */

app.post('/ai-test', async (req, res) => {
  try {
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({
        ok: false,
        error: 'Falta text'
      });
    }

    const answer = await askAI(text);

    res.json({
      ok: true,
      input: text,
      answer
    });

  } catch (error) {
    console.error('❌ Error /ai-test:', error);

    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/* =========================================================
   VOICE CHAT POR HTTP
========================================================= */

app.post('/voice-chat', upload.single('audio'), async (req, res) => {
  try {
    const audioFile = req.file;

    if (!audioFile) {
      return res.status(400).json({
        ok: false,
        error: 'No llegó ningún audio'
      });
    }

    console.log('🎤 Audio recibido:', audioFile.path);

    const userText = await speechToTextFromFile(audioFile.path);
    console.log('🧑 Usuario:', userText);
/**/
const textoLimpio = userText.trim().toLowerCase();

const frasesBasura = [
  'subtítulos realizados por la comunidad de amara.org',
  'subtitulos realizados por la comunidad de amara.org',
  'amara.org',
  'gracias por ver el video',
  'thank you for watching'
];

if (
  !textoLimpio ||
  textoLimpio.length < 3 ||
  frasesBasura.some(frase => textoLimpio.includes(frase))
) {
  console.log('⚠️ Transcripción basura ignorada:', userText);

  return res.json({
    ok: false,
    error: 'No se detectó voz válida'
  });
}

/**/

    const arianaText = await askAI(userText);
    console.log('🤖 Ariana:', arianaText);

    const audioBuffer = await textToSpeech(arianaText);

    const fileName = `ariana-${Date.now()}.mp3`;
    const outputPath = path.join(uploadDir, fileName);

    fs.writeFileSync(outputPath, audioBuffer);

    res.json({
      ok: true,
      userText,
      arianaText,
      audioUrl: `/uploads/${fileName}`
    });

  } catch (error) {
    console.error('❌ Error /voice-chat:', error);

    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/* =========================================================
   SOCKET.IO / WEBRTC / VOZ MANUAL
========================================================= */

io.on('connection', (socket) => {
  console.log('🟢 Cliente WebRTC conectado:', socket.id);

  socket.on('join-room', (data) => {
    const roomId = data.roomId;

    socket.join(roomId);

    console.log(`📌 Socket ${socket.id} entró a la sala ${roomId}`);

    socket.emit('joined-room', {
      ok: true,
      roomId,
      socketId: socket.id
    });

    socket.to(roomId).emit('user-joined', {
      socketId: socket.id,
      roomId
    });
  });

  socket.on('webrtc-offer', (data) => {
    console.log('📨 Offer recibida de', socket.id, 'para sala', data.roomId);

    socket.to(data.roomId).emit('webrtc-offer', {
      sdp: data.sdp,
      from: socket.id
    });
  });

  socket.on('webrtc-answer', (data) => {
    console.log('📨 Answer recibida de', socket.id, 'para sala', data.roomId);

    socket.to(data.roomId).emit('webrtc-answer', {
      sdp: data.sdp,
      from: socket.id
    });
  });

  socket.on('webrtc-ice-candidate', (data) => {
    socket.to(data.roomId).emit('webrtc-ice-candidate', {
      candidate: data.candidate,
      from: socket.id
    });
  });

  socket.on('voice-audio', async (data) => {
    try {
      console.log('🎤 Audio recibido desde navegador por socket');

      const audioBuffer = Buffer.from(data.audio, 'base64');
      const inputPath = path.join(uploadDir, `socket-audio-${Date.now()}.webm`);

      fs.writeFileSync(inputPath, audioBuffer);

      const text = await speechToTextFromFile(inputPath);
      console.log('🧑 Usuario:', text);

      const answer = await askAI(text);
      console.log('🤖 Ariana:', answer);

      const audioReply = await textToSpeech(answer);

      socket.emit('voice-response', {
        ok: true,
        text,
        answer,
        audio: audioReply.toString('base64')
      });

    } catch (error) {
      console.error('❌ Error voice-audio:', error);

      socket.emit('voice-response', {
        ok: false,
        error: error.message
      });
    }
  });

  socket.on('disconnect', () => {
    console.log('🔴 Cliente desconectado:', socket.id);
  });
});

/* =========================================================
   START
========================================================= */

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Middleware corriendo en puerto ${PORT}`);
});
