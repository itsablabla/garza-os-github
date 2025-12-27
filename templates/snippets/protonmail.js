/**
 * ProtonMail Snippet
 * IMAP-based email operations via ProtonMail Bridge
 * Used by CF MCP and Garza Home MCP
 */

const Imap = require('imap');
const { simpleParser } = require('mailparser');
const nodemailer = require('nodemailer');

// ProtonMail Bridge settings (local)
const IMAP_CONFIG = {
  user: process.env.PROTON_USER || 'jadengarza@pm.me',
  password: process.env.PROTON_BRIDGE_PASSWORD,
  host: '127.0.0.1',
  port: 1143,
  tls: false
};

const SMTP_CONFIG = {
  host: '127.0.0.1',
  port: 1025,
  secure: false,
  auth: {
    user: process.env.PROTON_USER || 'jadengarza@pm.me',
    pass: process.env.PROTON_BRIDGE_PASSWORD
  }
};

// Search emails
async function searchEmails(criteria = 'ALL', limit = 10) {
  return new Promise((resolve, reject) => {
    const imap = new Imap(IMAP_CONFIG);
    const results = [];
    
    imap.once('ready', () => {
      imap.openBox('INBOX', true, (err, box) => {
        if (err) return reject(err);
        
        imap.search([criteria], (err, uids) => {
          if (err) return reject(err);
          
          const fetch = imap.fetch(uids.slice(-limit), { bodies: '' });
          
          fetch.on('message', (msg) => {
            msg.on('body', (stream) => {
              simpleParser(stream, (err, parsed) => {
                if (!err) results.push({
                  uid: msg.uid,
                  from: parsed.from?.text,
                  subject: parsed.subject,
                  date: parsed.date,
                  snippet: parsed.text?.slice(0, 200)
                });
              });
            });
          });
          
          fetch.once('end', () => {
            imap.end();
            resolve(results);
          });
        });
      });
    });
    
    imap.once('error', reject);
    imap.connect();
  });
}

// Read single email by UID
async function readEmail(uid) {
  return new Promise((resolve, reject) => {
    const imap = new Imap(IMAP_CONFIG);
    
    imap.once('ready', () => {
      imap.openBox('INBOX', true, (err) => {
        if (err) return reject(err);
        
        const fetch = imap.fetch([uid], { bodies: '' });
        
        fetch.on('message', (msg) => {
          msg.on('body', (stream) => {
            simpleParser(stream, (err, parsed) => {
              imap.end();
              if (err) reject(err);
              else resolve(parsed);
            });
          });
        });
      });
    });
    
    imap.once('error', reject);
    imap.connect();
  });
}

// Send email
async function sendEmail({ to, subject, body, html }) {
  const transporter = nodemailer.createTransport(SMTP_CONFIG);
  
  const result = await transporter.sendMail({
    from: IMAP_CONFIG.user,
    to,
    subject,
    text: body,
    html
  });
  
  return result;
}

// Common search criteria patterns
const CRITERIA = {
  unread: ['UNSEEN'],
  fromPerson: (email) => [['FROM', email]],
  subject: (text) => [['SUBJECT', text]],
  since: (date) => [['SINCE', date]],  // 'Dec 25, 2025'
  recent: ['RECENT']
};

module.exports = { searchEmails, readEmail, sendEmail, CRITERIA };
