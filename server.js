const express = require('express');
const twilio = require('twilio');
const Anthropic = require('@anthropic-ai/sdk');
const https = require('https');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function sendLeadEmail(name, phone, callSid) {
        try {
                  const emailData = JSON.stringify({
                              personalizations: [{ to: [{ email: 'aqayali8@gmail.com' }] }],
                              from: { email: 'aqayali8@gmail.com' },
                              subject: 'DubcoreAI - New Lead',
                              content: [{ type: 'text/plain', value: 'Name: ' + name + '\nPhone: ' + phone + '\nCall ID: ' + callSid + '\n\nCall them back ASAP!' }]
                  });
                  const options = {
                              hostname: 'api.sendgrid.com',
                              path: '/v3/mail/send',
                              method: 'POST',
                              headers: {
                                            'Authorization': 'Bearer ' + process.env.SENDGRID_API_KEY,
                                            'Content-Type': 'application/json',
                                            'Content-Length': Buffer.byteLength(emailData)
                              }
                  };
                  await new Promise((resolve, reject) => {
                              const req = https.request(options, (res) => { console.log('Email status:', res.statusCode); resolve(); });
                              req.on('error', reject);
                              req.write(emailData);
                              req.end();
                  });
        } catch (err) {
                  console.error('Email error:', err.message);
        }
}

const conversations = new Map();

const SYSTEM_PROMPT = `You are an AI receptionist for DubcoreAI, an AI automation company based in Amory, Mississippi. Your job is to answer calls professionally, explain what DubcoreAI does, answer questions, and help callers book a free consultation.

ABOUT DUBCOREAI:
DubcoreAI provides AI-powered phone receptionists for small businesses. Instead of missing calls or paying for a full-time receptionist, businesses use DubcoreAI to have an AI answer every call 24/7 - booking appointments, answering questions, and taking messages automatically. Slogan: Every business is going to need AI. Be first.

WHO WE HELP:
Local businesses like HVAC companies, salons, law offices, dental offices, auto shops, and contractors. Any business that misses calls or cannot always answer the phone.

PRICING PLANS:
- Starter: $99/month - AI answers calls, takes messages, basic Q&A
- Professional: $149/month - Everything in Starter plus appointment booking and call summaries
- Premium: $199/month - Everything in Professional plus custom AI voice and priority support

CONTACT AND BOOKING:
- To book a FREE consultation: tell the caller the owner Aqay will call them back, and ask for their name and number
- Phone: (662) 321-9562
- Email: aqayali8@gmail.com
- Owner: Aqay (pronounced Ah-Kay)

HOW TO HANDLE CALLS:
- If someone asks what we do: explain we help businesses never miss a call using AI
- If someone asks about pricing: give them the plan options
- If someone wants to sign up or learn more: offer a free consultation and take their name and number
- If someone wants to speak to a person: say Aqay will call them back and take their contact info

COLLECTING LEAD INFO:
- When you have BOTH a caller name AND phone number, add this tag at the end: [LEAD:name=THEIR_NAME;phone=THEIR_PHONE]
- Only add this tag once you have both pieces of info

RULES:
- Keep every response SHORT, 1 to 2 sentences max. This is a phone call.
- Be warm, confident, and professional
- Never make up information not listed here`;

app.get('/', (req, res) => { res.sendFile(__dirname + '/public/index.html'); });

app.get('/status', (req, res) => {
        res.json({ status: 'live', service: 'DubcoreAI AI Receptionist', port: process.env.PORT || 3000 });
});

app.post('/incoming-call', async (req, res) => {
        const callSid = req.body.CallSid;
        const twiml = new twilio.twiml.VoiceResponse();
        conversations.set(callSid, []);
        const gather = twiml.gather({ input: 'speech', action: '/handle-response', method: 'POST', speechTimeout: 'auto', language: 'en-US' });
        gather.say({ voice: 'Polly.Joanna' }, 'Thank you for calling DubcoreAI. I am your AI assistant. How can I help you today?');
        res.type('text/xml');
        res.send(twiml.toString());
});

app.post('/handle-response', async (req, res) => {
        const callSid = req.body.CallSid;
        const speechResult = req.body.SpeechResult || '';
        const twiml = new twilio.twiml.VoiceResponse();

           if (!speechResult) {
                     const gather = twiml.gather({ input: 'speech', action: '/handle-response', method: 'POST', speechTimeout: 'auto' });
                     gather.say({ voice: 'Polly.Joanna' }, "I didn't catch that. Could you say that again?");
                     res.type('text/xml');
                     return res.send(twiml.toString());
           }

           const history = conversations.get(callSid) || [];
        history.push({ role: 'user', content: speechResult });

           try {
                     const response = await client.messages.create({
                                 model: 'claude-haiku-4-5-20251001',
                                 max_tokens: 150,
                                 system: SYSTEM_PROMPT,
                                 messages: history
                     });

          const aiReply = response.content[0].text;
                     history.push({ role: 'assistant', content: aiReply });
                     conversations.set(callSid, history);

          const leadMatch = aiReply.match(/\[LEAD:name=([^;]+);phone=([^\]]+)\]/);
                     if (leadMatch) {
                                 await sendLeadEmail(leadMatch[1].trim(), leadMatch[2].trim(), callSid);
                     }

          const cleanReply = aiReply.replace(/\[LEAD:[^\]]+\]/g, '').trim();
                     const gather = twiml.gather({ input: 'speech', action: '/handle-response', method: 'POST', speechTimeout: 'auto' });
                     gather.say({ voice: 'Polly.Joanna' }, cleanReply);

           } catch (error) {
                     console.error('Claude API error:', error);
                     twiml.say({ voice: 'Polly.Joanna' }, 'I apologize, I am having a brief technical issue. Please call back in a moment or email us at aqayali8@gmail.com. Thank you!');
                     twiml.hangup();
           }

           res.type('text/xml');
        res.send(twiml.toString());
});

app.post('/call-status', (req, res) => {
        const { CallSid, CallStatus } = req.body;
        console.log('Call ' + CallSid + ': ' + CallStatus);
        if (CallStatus === 'completed') conversations.delete(CallSid);
        res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log('DubcoreAI AI Receptionist running on port ' + PORT); });
