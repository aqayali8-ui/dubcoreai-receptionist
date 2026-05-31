const express = require('express');
const twilio = require('twilio');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Store conversations per call
const conversations = new Map();

const SYSTEM_PROMPT = `You are an AI receptionist for DubcoreAI, an AI automation company based in Amory, Mississippi. You answer calls professionally, help callers book consultations, answer questions about services, and take messages.

DubcoreAI offers:
- AI Phone Receptionist: $99/mo Starter, $149/mo Professional, $199/mo Premium
- Slogan: "Every business is going to need AI. Be first."
- Phone: (662) 321-9562
- Email: aqayali8@gmail.com
- Owner: Aqay Scimu Bey Ali (also known as LeRon Mundy)

Keep responses SHORT — 1-2 sentences max. This is a phone call. Be warm, professional, and helpful. Always offer to book a free consultation or take a message.`;

// Root - serve website
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

app.get('/status', (req, res) => {
  res.json({ status: 'live', service: 'DubcoreAI AI Receptionist', port: process.env.PORT || 3000 });
});

// Incoming call handler
app.post('/incoming-call', async (req, res) => {
  const callSid = req.body.CallSid;
  const twiml = new twilio.twiml.VoiceResponse();

  conversations.set(callSid, []);

  const gather = twiml.gather({
    input: 'speech',
    action: '/handle-response',
    method: 'POST',
    speechTimeout: 'auto',
    language: 'en-US'
  });

  gather.say({ voice: 'Polly.Joanna' },
    'Thank you for calling DubcoreAI. I\'m your AI assistant. How can I help you today?'
  );

  res.type('text/xml');
  res.send(twiml.toString());
});

// Handle caller response
app.post('/handle-response', async (req, res) => {
  const callSid = req.body.CallSid;
  const speechResult = req.body.SpeechResult || '';
  const twiml = new twilio.twiml.VoiceResponse();

  if (!speechResult) {
    const gather = twiml.gather({
      input: 'speech',
      action: '/handle-response',
      method: 'POST',
      speechTimeout: 'auto'
    });
    gather.say({ voice: 'Polly.Joanna' }, "I didn't catch that. Could you say that again?");
    res.type('text/xml');
    return res.send(twiml.toString());
  }

  const history = conversations.get(callSid) || [];
  history.push({ role: 'user', content: speechResult });

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 150,
      system: SYSTEM_PROMPT,
      messages: history
    });

    const aiReply = response.content[0].text;
    history.push({ role: 'assistant', content: aiReply });
    conversations.set(callSid, history);

    const gather = twiml.gather({
      input: 'speech',
      action: '/handle-response',
      method: 'POST',
      speechTimeout: 'auto'
    });
    gather.say({ voice: 'Polly.Joanna' }, aiReply);

  } catch (error) {
    console.error('Claude API error:', error);
    twiml.say({ voice: 'Polly.Joanna' },
      'I apologize, I\'m having a brief technical issue. Please call back in a moment or email us at aqayali8@gmail.com. Thank you!'
    );
    twiml.hangup();
  }

  res.type('text/xml');
  res.send(twiml.toString());
});

// Call status updates
app.post('/call-status', (req, res) => {
  const { CallSid, CallStatus } = req.body;
  console.log(`Call ${CallSid}: ${CallStatus}`);
  if (CallStatus === 'completed') conversations.delete(CallSid);
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`DubcoreAI AI Receptionist running on port ${PORT}`);
});
