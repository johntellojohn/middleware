require('dotenv').config();

const fs = require('fs');
const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function speechToTextFromFile(filePath) {
  const transcription = await openai.audio.transcriptions.create({
    file: fs.createReadStream(filePath),
    model: 'whisper-1',
    language: 'es'
  });

  return transcription.text || '';
}

async function askAI(text) {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'Eres Ariana, una asistente de soporte técnico. Responde en español, corto, claro y amable.'
      },
      {
        role: 'user',
        content: text
      }
    ]
  });

  return response.choices[0].message.content;
}

async function textToSpeech(text) {
  const response = await openai.audio.speech.create({
    model: 'gpt-4o-mini-tts',
    voice: 'alloy',
    input: text,
    format: 'mp3'
  });

  return Buffer.from(await response.arrayBuffer());
}

module.exports = {
  speechToTextFromFile,
  askAI,
  textToSpeech
};
