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
  const { data: dataOffer, error: errorOffer } = await supabase
    .from('calls')
    .update({ offerCandidate: candidate })
    .eq('id', callId)
    .select();

  if (errorOffer) {
    console.error('Error creating offer:', errorOffer);
  } else {
    // console.log('Offer Created:', dataOffer);
  }
}

const makeAnswerCandidate = async (callId, candidate) => {
  const { data: dataAnswer, error: errorAnswer } = await supabase
    .from('calls')
    .update({ answerCandidate: candidate })
    .eq('id', callId)
    .select();

  if (errorAnswer) {
    console.error('Error creating answer:', errorAnswer);
  } else {
    // console.log('Answer Created:', dataOffer);
  }
}

callButton.onclick = async () => {
  let CALL_ID = null;

  const { data: dataGet, error: errorGet } = await supabase
    .from('calls')
    .insert({})
    .select()
    .single();

  if (errorGet) {
    console.error('Error creating call:', errorGet);
  } else {
    // console.log('New call created:', dataGet);
    callInput.value = dataGet.id
    CALL_ID = dataGet.id
  }

  pc.onicecandidate = event => {
    event.candidate && makeOfferCandidate(CALL_ID, event.candidate.toJSON())
  }

  const offerDescription = await pc.createOffer()
  await pc.setLocalDescription(offerDescription)

  const offer = {
    sdp: offerDescription.sdp,
    type: offerDescription.type
  }

  const { data: dataSet, error: errorSet } = await supabase
    .from('calls')
    .update({ offer })
    .eq('id', dataGet.id)
    .select();

  if (errorSet) {
    console.error('Error update offer:', errorSet);
  } else {
    // console.log('Offer updated:', dataSet);
  }

  const subscription = supabase
    .channel('calls_changes')
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'calls',
        filter: `id=eq.${CALL_ID}`
      },
      (payload) => {
        // console.log('Изменение получено!', payload.new)
        if (!pc.currentRemoteDescription && payload.new.answer) {
          const answerDescription = new RTCSessionDescription(payload.new.answer);
          pc.setRemoteDescription(answerDescription);
        }

        if (payload.new.answerCandidate) {
          console.log('answer: ', payload.new.answerCandidate);

          const candidate = new RTCIceCandidate(payload.new.answerCandidate);
          pc.addIceCandidate(candidate);
        }
      }
    )
    .subscribe()

  // hangupButton.disabled = false;
  // answerButton.disabled = true;
}


answerButton.onclick = async () => {
  const callId = callInput.value;
  if (!callId) return

  const { data: dataCall, error: errorCall } = await supabase
    .from('calls')
    .select()
    .eq('id', callId)
    .single()

  if (errorCall) {
    console.error('Error get call:', errorCall);
  } else {
    // console.log('Finded call:', dataCall);
  }

  pc.onicecandidate = (event) => {
    event.candidate && makeAnswerCandidate(callId, event.candidate.toJSON());
  };

  const offerDescription = dataCall.offer;

  await pc.setRemoteDescription(new RTCSessionDescription(offerDescription));

  const answerDescription = await pc.createAnswer();
  await pc.setLocalDescription(answerDescription);

  const answer = {
    type: answerDescription.type,
    sdp: answerDescription.sdp,
  };

  const { data: dataSet, error: errorSet } = await supabase
    .from('calls')
    .update({ answer })
    .eq('id', callId)
    .select();

  if (errorSet) {
    console.error('Error update answer:', errorSet);
  } else {
    // console.log('Answer updated:', dataSet);
  }


  const subscription = supabase
    .channel('calls_changes')
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'calls',
        filter: `id=eq.${callId}`
      },
      (payload) => {
        // console.log('Изменение получено!', payload.new)

        if (payload.new.offerCandidate) {
          console.log('OFFER: ', payload.new.offerCandidate);

          const candidate = new RTCIceCandidate(payload.new.offerCandidate);
          pc.addIceCandidate(candidate);
        }
      }
    )
    .subscribe()
};
