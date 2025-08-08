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
    .select();

  if (errorOffer) {
    console.error('Error creating offer:', errorOffer);
  }
}

const makeAnswerCandidate = async (callId, candidate) => {
  const { error: errorAnswer } = await supabase
    .from('calls')
    .update({ answerCandidate: candidate })
    .eq('id', callId)
    .select();

  if (errorAnswer) {
    console.error('Error creating answer:', errorAnswer);
  }
}

callButton.onclick = async () => {
  let CALL_ID = null;

  const offerDescription = await pc.createOffer()
  await pc.setLocalDescription(offerDescription)

  const offer = {
    type: offerDescription.type,
    sdp: offerDescription.sdp
  }

  const { data: dataSet, error: errorSet } = await supabase
    .from('calls')
    .insert({ offer })
    .select();

  if (errorSet) {
    console.error('Error update offer:', errorSet)
  } else {
    callInput.value = dataSet.id
    CALL_ID = dataSet.id

    pc.onicecandidate = event => {
      console.log('IN CALL: ', event);

      event.candidate && makeOfferCandidate(CALL_ID, event.candidate.toJSON())
    }
  }


  // const subscription = supabase
  //   .channel('calls_changes')
  //   .on(
  //     'postgres_changes',
  //     {
  //       event: 'UPDATE',
  //       schema: 'public',
  //       table: 'calls',
  //       filter: `id=eq.${CALL_ID}`
  //     },
  //     async (payload) => {
  //       console.log(payload);

  //       if (!pc.remoteDescription && payload.new.answer) {
  //         try {
  //           const answerDescription = new RTCSessionDescription(payload.new.answer);

  //           await pc.setRemoteDescription(answerDescription);

  //           if (payload.new.answerCandidate) {
  //             try {
  //               if (pc.remoteDescription) {
  //                 const candidate = new RTCIceCandidate(payload.new.answerCandidate);
  //                 await pc.addIceCandidate(candidate);
  //               }
  //             } catch (error) {
  //               console.error('2 НЕ УДАЛОСЬ УСТАНОВИТЬ СОБЕСЕДНИКА', error);
  //             }
  //           }

  //         } catch (error) {
  //           console.error('1 НЕТ ОПИСАНИЯ УДАЛЕННОГО СОБЕСЕДНИКА', error);
  //         }
  //       }

  //     }
  //   )
  //   .subscribe()
}


answerButton.onclick = async () => {
  const callId = callInput.value;
  if (!callId) return

  const { data: dataCall, error: errorCall } = await supabase
    .from('calls')
    .select()
    .eq('id', callId)
    .single()

  if (errorCall) { console.error('Error get call:', errorCall) }

  pc.onicecandidate = (event) => {
    console.log('IN ANSWER: ', event);
    event.candidate && makeAnswerCandidate(callId, event.candidate.toJSON());
  };

  try {
    await pc.setRemoteDescription(new RTCSessionDescription(dataCall.offer));

    const answerDescription = await pc.createAnswer();
    await pc.setLocalDescription(answerDescription);

    const answer = {
      type: answerDescription.type,
      sdp: answerDescription.sdp,
    };

    const { error: errorSet } = await supabase
      .from('calls')
      .update({ answer })
      .eq('id', callId)
      .select();

    if (errorSet) { console.error('Error update answer:', errorSet) }

    // const subscription = supabase
    //   .channel('calls_changes')
    //   .on(
    //     'postgres_changes',
    //     {
    //       event: 'UPDATE',
    //       schema: 'public',
    //       table: 'calls',
    //       filter: `id=eq.${callId}`
    //     },
    //     (payload) => {
    //       if (payload.new.offerCandidate) {
    //         try {
    //           pc.addIceCandidate(new RTCIceCandidate(payload.new.offerCandidate));
    //         } catch (error) {
    //           console.error('3 Нет кандидата собеседника:', error);
    //         }
    //       }
    //     }
    //   )
    //   .subscribe()
  } catch (error) {
    console.error('4 Ошибка при отправке ответа:', error);
  }
};
