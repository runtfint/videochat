import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey)

const servers = {
  iceServers: [
    { urls: ['stun:stun1.l.google.com:19032', 'stun:stun2.l.google.com:19032'] }
  ],
  iceCandidatePoolSize: 10,
}

let pc = new RTCPeerConnection(servers);

let localStream = null;
let remoteStream = null;

const webcamButton = document.getElementById('webcamButton');
const webcamVideo = document.getElementById('webcamVideo');
const callButton = document.getElementById('callButton');
const callInput = document.getElementById('callInput');
const answerButton = document.getElementById('answerButton');
const remoteVideo = document.getElementById('remoteVideo');
const hangupButton = document.getElementById('hangupButton');

webcamButton.onclick = async () => {
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
  remoteStream = new MediaStream();

  localStream.getTracks().forEach(track => {
    pc.addTrack(track, localStream)
  })

  pc.ontrack = event => {
    event.streams[0].getTracks().forEach(track => {
      remoteStream.addTrack(track)
      remoteVideo.srcObject = remoteStream;
    })
  }

  webcamVideo.srcObject = localStream;
  remoteVideo.srcObject = remoteStream;
}

const makeOfferCandidate = async (callId, candidate) => {
  const { error: errorOffer } = await supabase
    .from('calls')
    .update({ offerCandidate: candidate })
    .eq('id', callId)

  if (errorOffer) {
    console.error('Error creating offer:', errorOffer);
  }
}

const makeAnswerCandidate = async (callId, candidate) => {
  const { error: errorAnswer } = await supabase
    .from('calls')
    .update({ answerCandidate: candidate })
    .eq('id', callId)

  if (errorAnswer) {
    console.error('Error creating answer:', errorAnswer);
  }
}

callButton.onclick = async () => {
  let CALL_ID = null;

  const { data: dataCreateCall } = await supabase
    .from('calls')
    .insert({})
    .select()
    .single();

  if (dataCreateCall) {
    callInput.value = dataCreateCall.id
    CALL_ID = dataCreateCall.id
  }

  pc.onicecandidate = event => {
    event.candidate && makeOfferCandidate(CALL_ID, event.candidate.toJSON())
  }

  const offerDescription = await pc.createOffer()
  await pc.setLocalDescription(offerDescription)

  await supabase
    .from('calls')
    .update({
      offer: {
        type: offerDescription.type,
        sdp: offerDescription.sdp
      }
    })
    .eq('id', CALL_ID)


  const s1 = supabase
    .channel('calls_changes')
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'calls',
        filter: `id=eq.${CALL_ID}`
      },
      async (payload) => {
        console.log(payload);

        if (!pc.currentRemoteDescription && !payload.old.answer && !!payload.new.answer) {
          console.log('ahuet', payload.new.answer);
          const answerDescription = new RTCSessionDescription(payload.new.answer);
          await pc.setRemoteDescription(answerDescription);
        }
      }
    )
    .subscribe()

  const s2 = supabase
    .channel('calls_changes')
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'calls',
        filter: `id=eq.${CALL_ID}`
      },
      async (payload) => {
        if (!!payload.new.answerCandidate) {
          console.log('blya');
          const candidate = new RTCIceCandidate(payload.new.answerCandidate);
          await pc.addIceCandidate(candidate);
        }
      }
    )
    .subscribe()
}


answerButton.onclick = async () => {
  const callId = callInput.value;
  if (!callId) return

  const { data: dataCall } = await supabase
    .from('calls')
    .select()
    .eq('id', callId)
    .single()

  pc.onicecandidate = (event) => {
    console.log('IN ANSWER: ', event);
    event.candidate && makeAnswerCandidate(callId, event.candidate.toJSON());
  };

  try {
    await pc.setRemoteDescription(new RTCSessionDescription(dataCall.offer));

    const answerDescription = await pc.createAnswer();
    await pc.setLocalDescription(answerDescription);

    await supabase
      .from('calls')
      .update({
        answer: {
          type: answerDescription.type,
          sdp: answerDescription.sdp,
        }
      })
      .eq('id', callId)

  } catch (error) {
    console.error('4 Ошибка при отправке ответа:', error);
  }
};
