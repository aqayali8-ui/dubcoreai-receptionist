const express = require('express');
const twilio = require('twilio');
const Anthropic = require('@anthropic-ai/sdk');
const nodemailer = require('nodemailer');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Nodemailer transporter
const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
              user: process.env.GMAIL_USER,
              pass: process.env.GMAIL_APP_PASSWORD
      }
});

async function sendLeadEmail(name, phone, callSid) {
      try {
              await transporter.sendMail({
                        from: process.env.GMAIL_USER,
                        to: 'aqayali8@gmail.com',
                        subject: 'DubcoreAI - New Lead from Phone Call',
                        html: `
                                <h2>New Lead - DubcoreAI Receptionist</h2>
                                        <p><strong>Name:</strong> ${name}</p>
                                                <p><strong>Phone:</strong> ${phone}</p>
                                                        <p><strong>Call ID:</strong> ${callSid}</p>
                                                                <p><strong>Time:</strong> ${new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })} CST</p>
                                                                        <p>Call them back at your earliest convenience!</p>
                                                                              `
              });
              console.log('Lead email sent for:', name, phone);
      } catch (err) {
              console.error('Email send error:', err);
      }
}

// Store conversations per call
const conversations = new Map();

const SYSTEM_PROMPT = `You are an AI receptionist for DubcoreAI, an AI automation company based in Amory, Mississippi. Your job is to answer calls professionally, explain what DubcoreAI does, answer questions, and help callers book a free consultation.

ABOUT DUBCOREAI:
DubcoreAI provides AI-powered phone receptionists for small businesses. Instead of missing calls or paying for a full-time receptionist, businesses use DubcoreAI to have an AI answer every call 24/7 — booking appointments, answering questions, and taking messages automatically. Slogan: Every business is going to need AI. Be first.

WHO WE HELP:
Local businesses like HVAC companies, salons, law offices, dental offices, auto shops, and contractors. Any business that misses calls or cannot always answer the phone.

PRICING PLANS:
- Starter: $99/month — AI answers calls, takes messages, basic Q&A
- Professional: $149/month — Everything in Starter plus appointment booking and call summaries
- Premium: $199/month — Everything in Professional plus custom AI voice and priority support

CONTACT AND BOOKING:
- To book a FREE consultation: tell the caller the owner Aqay will call them back, and ask for their name and number
- Phone: (662) 321-9562
- Email: aqayali8@gmail.com
- Owner: Aqay (pronounced Ah-Kay)

HOW TO HANDLE CALLS:
- If someone asks what we do: explain we help businesses never miss a call using AI
- If someone asks about pricing: give them the plan options
- If someone wants to sign up or learn more: offer a free consultation and take their name and number
- If someone asks something you do not know: say you will have Aqay follow up with them directly
- If someone wants to speak to a person: say Aqay will call them back and take their contact info

COLLECTING LEAD INFO:
- When you collect a caller's name and phone number, include this EXACT tag at the end of your response: [LEAD:name=THEIR_NAME;phone=THEIR_PHONE]
- Example: [LEAD:name=John Smith;phone=662-555-1234]
- Only include this tag once you have BOTH name AND phone number

RULES:
- Keep every response SHORT, 1 to 2 sentences max. This is a phone call.
- Be warm, confident, and professional
- Never make up information not listed here
- Always end by offering to book a free consultation or take a message`;

app.get('/', (req, res) => {
      res.sendFile(__dirname + '/public/index.html');
});

app.get('/status', (req, res) => {
      res.json({ status: 'live', service: 'DubcoreAI AI Receptionist', port: process.env.PORT || 3000 });
});

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

        // Check for lead tag and send email
        const leadMatch = aiReply.match(/\[LEAD:name=([^;]+);phone=([^\]]+)\]/);
                   if (leadMatch) {
                             const leadName = leadMatch[1].trim();
                             const leadPhone = leadMatch[2].trim();
                             await sendLeadEmail(leadName, leadPhone, callSid);
                   }

        // Strip the lead tag before speaking
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
      console.log(`Call ${CallSid}: ${CallStatus}`);
      if (CallStatus === 'completed') conversations.delete(CallSid);
      res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
      console.log(`DubcoreAI AI Receptionist running on port ${PORT}`);
});
