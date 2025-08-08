import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey)

const servers = {
  iceServers: [
    { urls: ['stun:stun1.l.google.com:19032', 'stun:stun2.l.google.com:19032'] }
  ],
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
    console.log('ON TRACK', event);

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

pc.onsignalingstatechange = () => {
  console.log('signalingState', pc.signalingState);
}

pc.onconnectionstatechange = () => {
  console.log('connectionState', pc.connectionState);
}

pc.oniceconnectionstatechange = () => {
  console.log('iceConnectionState', pc.iceConnectionState);
}

pc.onicegatheringstatechange = () => {
  console.log('iceGatheringState', pc.iceGatheringState);
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


  const answerSubscription = supabase
    .channel('call_answer_changes')
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'calls',
        filter: `id=eq.${CALL_ID}`,
      },
      (payload) => {
        const newAnswer = payload.new.answer;
        if (newAnswer && !pc.currentRemoteDescription) {
          const answerDescription = new RTCSessionDescription(newAnswer);
          pc.setRemoteDescription(answerDescription).catch(console.error);
        }

        const newCandidate = payload.new.answerCandidate;
        const oldCandidate = payload.old?.answerCandidate;

        if (newCandidate && newCandidate !== oldCandidate) {
          const iceCandidate = new RTCIceCandidate(newCandidate);
          pc.addIceCandidate(iceCandidate).catch(console.error);
        }
      }
    )
    .subscribe();
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

    const offerCandidateSubscription = supabase
      .channel('call_offer_candidate_changes')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'calls',
          filter: `id=eq.${callId}`,
        },
        (payload) => {
          const newCandidate = payload.new.offerCandidate;
          const oldCandidate = payload.old?.offerCandidate;

          if (newCandidate && newCandidate !== oldCandidate) {
            const iceCandidate = new RTCIceCandidate(newCandidate);
            pc.addIceCandidate(iceCandidate).catch(console.error);
          }
        }
      )
      .subscribe();

  } catch (error) {
    console.error('4 Ошибка при отправке ответа:', error);
  }
};
