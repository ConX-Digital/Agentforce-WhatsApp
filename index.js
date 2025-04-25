const express = require('express');
const axios = require('axios');
const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const streamifier = require('streamifier');

const fs = require('fs-extra');
const tmp = require('tmp');
const path = require('path');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

require('dotenv').config();

const app = express();
app.use(express.json({ limit: '10mb' }));

// Configure AWS S3
const s3 = new AWS.S3({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Step 1: Get OAuth token from Marketing Cloud
async function getMarketingCloudToken() {
  const response = await axios.post(process.env.MC_AUTH_URL, {
    client_id: process.env.MC_CLIENT_ID,
    client_secret: process.env.MC_CLIENT_SECRET,
    account_id: process.env.MC_ACCOUNT_ID,
    grant_type: 'client_credentials',
  });

  return response.data.access_token;
}

// Step 2: Download OTT media file
async function downloadMedia(token, audioId, senderId, senderType) {
  const mediaUrl = `${process.env.MC_REST_URL}/ott/v1/media/download/${audioId}?SenderId=${encodeURIComponent(senderId)}&SenderType=${encodeURIComponent(senderType)}`;
  console.log('Media URL:', mediaUrl);
  const response = await axios.get(mediaUrl, {
    responseType: 'arraybuffer',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const audioBuffer = response.data;
//   console.log("File URL:", response);
  // Download file binary
//   const fileData = await axios.get(fileUrl, { responseType: 'arraybuffer' });
  return { buffer: audioBuffer, mimeType: 'audio/ogg' };
}

async function convertOggToMp3(buffer) {
    return new Promise((resolve, reject) => {
      const inputFile = tmp.tmpNameSync({ postfix: '.opus' }); // <- try .opus too
      const outputFile = tmp.tmpNameSync({ postfix: '.mp3' });

      fs.writeFileSync(inputFile, buffer);

      ffmpeg(inputFile)
        .audioCodec('libmp3lame')
        .format('mp3')
        .on('error', (err) => {
          console.error('FFmpeg error:', err.message);
          reject(err);
        })
        .on('end', () => {
          try {
            const mp3Buffer = fs.readFileSync(outputFile);
            fs.unlinkSync(inputFile);
            fs.unlinkSync(outputFile);
            resolve(mp3Buffer);
          } catch (readErr) {
            reject(readErr);
          }
        })
        .save(outputFile);
    });
  }


// Step 3: Upload to S3
async function uploadToS3(buffer) {
  const mp3Buffer = await convertOggToMp3(buffer);
  const fileKey = `audio/${uuidv4()}.mp3`;
  await s3.putObject({
    Bucket: process.env.S3_BUCKET,
    Key: fileKey,
    Body: mp3Buffer,
    ContentType: 'audio/mpeg',
    ACL: 'public-read',
  }).promise();

  return `https://${process.env.S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileKey}`;
}

const ASSEMBLYAI_API = 'https://api.assemblyai.com/v2/transcript';

async function sendToAssemblyAI(audioUrl) {
  const response = await axios.post(ASSEMBLYAI_API, {
    audio_url: audioUrl
  }, {
    headers: {
      Authorization: process.env.ASSEMBLYAI_API_KEY,
      'Content-Type': 'application/json'
    }
  });

  return response.data.id; // transcription ID
}

async function getTranscript(transcriptId) {
  const pollingUrl = `${ASSEMBLYAI_API}/${transcriptId}`;

  // Optional: Polling loop
  while (true) {
    const response = await axios.get(pollingUrl, {
      headers: {
        Authorization: process.env.ASSEMBLYAI_API_KEY
      }
    });

    const status = response.data.status;
    if (status === 'completed') {
      return response.data.text;
    } else if (status === 'error') {
      throw new Error(`AssemblyAI transcription failed: ${response.data.error}`);
    }

    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
}


// Step 4: Send to another API
async function sendToDestinationAPI(payload) {
  await axios.post(process.env.DESTINATION_API, payload);
}

// Main route
app.post('/upload-audio', async (req, res) => {
  try {
        console.log("Endpoint hit!");
      const data = req.body;
      console.log('Received Data:', data);
      res.status(200).json({ success: true, message: 'Received, processing started.' });
      const audioId = data.audioId;
      const senderId = data.channelId;
      const senderType = data.senderType;

    console.log('Audio ID:', audioId);
    console.log('Sender ID:', senderId);
    console.log('Sender Type:', senderType);
    const token = await getMarketingCloudToken();
    console.log('OAuth Token:', token);
    const { buffer, mimeType } = await downloadMedia(token, audioId, senderId, senderType);
    console.log("Here");
    const publicUrl = await uploadToS3(await convertOggToMp3(buffer));

    const responsePayload = {
      contactId: data.contactId,
      mobileNumber: data.mobileNumber,
      audioUrl: publicUrl,
      timestamp: new Date(data.timestampUTC),
    };

    console.log('Response Payload:', responsePayload);

    // Send to AssemblyAI
    const transcriptId = await sendToAssemblyAI(publicUrl);
    console.log('Transcript ID:', transcriptId);

    // Wait and get transcription
    const transcriptionText = await getTranscript(transcriptId);
    console.log('Transcribed text:', transcriptionText);

    // // Send to final destination
    // await sendToDestinationAPI({
    // ...responsePayload,
    // transcription: transcriptionText
    // });

    const response = await axios.post(
        `${process.env.MC_REST_URL}/data/v1/async/dataextensions/key:TranscribedAudio_Log/rows`,
        {
            "items": [
                {
                    "contactId": data.contactId,
                    "mobileNumber": data.mobileNumber,
                    "audioUrl": publicUrl,
                    "transcription": transcriptionText,
                    "time": new Date(data.timestampUTC),
                }
            ]
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      console.log('Data Extension Response:', response.data);


    const whatsappPayload = JSON.stringify({
        "text": transcriptionText,
        "contactId": data.contactId,
        "mobileNumber": data.mobileNumber
      });

    console.log('Whatsapp Payload:', whatsappPayload);

    // Send response
    const response2 = await axios.post(
        `https://cloud.info.lc.ac.ae/agentforce-api`,
        whatsappPayload,
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      console.log('Whatsapp Send Response:', response2.data);


    // res.status(200).json({ success: true, audioUrl: publicUrl, transcription: transcriptionText });

  } catch (err) {
    console.error('Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
