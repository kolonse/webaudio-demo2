class FileSave
{
    constructor(filename, size)
    {
        this.fileName = filename ;
        this.buffLenth = size;
        this.buff = this.createBuff() ;
        this.writeLen = 0;
        this.seq = 0;
    }

    appendData( data, len)
    {
        this.buff.set(data, this.writeLen);
        this.writeLen += len ;

        if (this.writeLen >= this.buffLenth) {
            let buff = this.buff;
            let filename = this.fileName + "." + this.seq;
            let blob = new Blob([ buff.buffer ], {type : "application/octet-stream"});
            // this.openDownloadDialog(blob, filename);

            this.buff = this.createBuff();
            this.seq ++ ;
            this.writeLen = 0;
        }
    }

    createBuff() {
        throw ("must be implement");
    }

    openDownloadDialog(url, saveName)
    {
        if(typeof url == 'object' && url instanceof Blob)
        {
            url = URL.createObjectURL(url); // 创建blob地址
        }
        var aLink = document.createElement('a');
        aLink.href = url;
        aLink.download = saveName || ''; // HTML5新增的属性，指定保存文件名，可以不要后缀，注意，file:///模式下不会生效
        var event;
        if(window.MouseEvent) event = new MouseEvent('click');
        else
        {
            event = document.createEvent('MouseEvents');
            event.initMouseEvent('click', true, false, window, 0, 0, 0, 0, 0, false, false, false, false, 0, null);
        }
        aLink.dispatchEvent(event);
    }
}

class FileSaveFloat32 extends FileSave
{
    constructor(filename, size)
    {
        super(filename, size);
    }

    createBuff()
    {
        return new Float32Array(this.buffLenth) ;
    }
}







class wokletNode extends AudioWorkletNode {
    constructor(context) {
        super(context, 'myworklet');
        this.port.onmessage = this.handleMessage.bind(this);
        this.count = 0;
        this.sampleRate = context.sampleRate;
        this.fileName = new Date().getTime();
        this.fileSave = new FileSaveFloat32("" + this.fileName + "_" + ".float32." + this.sampleRate + ".pcm", this.sampleRate * 10 );
    }

    handleMessage(event) {
        // let data = event.data;
        // // this.fileSave.appendData(data, data.length);
        // this.count++;

        // this.checkZeroData(data,(t) =>{
        //     // log(new Date(), "@ " + (this.count * 10 / 1000) + " s", " happen zero data, length :", t );
        // });
    }

    // checkZeroData(data,cb) {
        // let count = 0;
        // for (let i = 0;i < data.length; i ++) {
        //     if (data[i] == 0) {
        //         count ++ ;
        //     } else {
        //         if (count != 0) {
        //             cb (count);
        //         }
        //         count = 0;
        //     }
        // }

        // if (count !== 0) {
        //     cb (count);
        // }
    // }
}















class AudioTest {
    constructor(cb, constraints, usePeerConn, useWorklet) {
        this.audioContext       = null;
        this.audioStreamNode    = null;
        this.onTextUpdate       = cb;
        this.beginTime          = 0;
        this.sampleRate         = 16000;
        this.ringBuffer         = new RingBuffer( this.sampleRate * 10 /1000 );
        this.count              = 0;
        this.audioWorkletNode   = null;
        this.constraints        = constraints;
        this.usePeerConn        = usePeerConn;
        this.useWorklet         = useWorklet;
        this.rtcConnection      = null;
        this.rtcLoopbackConnection = null;
    }

    start() {
        navigator.mediaDevices.getUserMedia({audio: this.constraints})
            .then(this.createAudioContext.bind(this))
            .then(this.createWorkletNode.bind(this))
            .then(this.connectWorkletNode.bind(this))
            .catch(console.log);
    }

    stop() {
      try {
        if (this.rtcConnection) {
          this.rtcConnection.close();
          this.rtcConnection = null;
        }

        if (this.rtcLoopbackConnection) {
          this.rtcLoopbackConnection.close();
          this.rtcLoopbackConnection = null;
        }
      } catch (e) {
        log(JSON.stringify(e))
      }

      if (this.audioStreamNode)
        this.audioStreamNode.disconnect();

      if (this.audioWorkletNode)
        this.audioWorkletNode.disconnect();

      if (this.audioContext) {
        this.audioContext.close();
        this.audioContext = null;
      }

      if (this.audioDomNode){
        this.audioDomNode.srcObject = null;
        this.audioDomNode.stop();
        this.audioDomNode = null;
      }
    }

    createAudioContext(stream) {
      console.log(stream.getAudioTracks()[0].getSettings());

      this.audioContext = new AudioContext({sampleRate : this.sampleRate});
      this.audioStreamNode = this.audioContext.createMediaStreamSource(stream);
      if (this.useWorklet) {
        return new Promise(resolve => resolve());
      } else {
        this.onTextUpdate(new Date(), "only playout input-audio !!!");
        this.audioStreamNode.connect(this.audioContext.destination);
        return new Promise((resolve, reject) => reject());
      }
    }

    createWorkletNode() {
      let that = this;
      return this.audioContext.audioWorklet.addModule("worklet.js")
          .then(() => {
            that.audioWorkletNode = new wokletNode(that.audioContext);
            return new Promise(resolve => resolve());
          });
    }

    async connectWorkletNode() {
        this.audioStreamNode.connect(this.audioWorkletNode);
        let dest = this.audioContext.createMediaStreamDestination();
        this.audioWorkletNode.connect(dest);
        let workaroundstream = await this.chromeAecWorkAround(dest.stream);

        if (!this.audioDomNode) {
            this.audioDomNode = new Audio();
        }
        this.audioDomNode.srcObject = workaroundstream;
        this.audioDomNode.play();
        console.log(JSON.stringify(this.audioDomNode));
        this.onTextUpdate("\n")
        this.onTextUpdate(new Date(), "start record");
        this.beginTime = new Date().getTime();
    }

    isZeroData(data) {
        let flag = true;
        for (let i = 0;i < data.length;i ++) {
            if (data[i] !== 0) {
                flag = false;
                break;
            }
        }

        return flag;
    }

    async chromeAecWorkAround (sourcestream) {
        if (!this.usePeerConn) {
            return sourcestream;
        }

        let loopbackStream = new MediaStream(); // this is the stream you will read from for actual audio output

        const offerOptions = {
            offerVideo: false,
            offerAudio: true,
            offerToReceiveAudio: false,
            offerToReceiveVideo: false,
        };

        let offer, answer;

        this.rtcConnection = new RTCPeerConnection();
        this.rtcLoopbackConnection = new RTCPeerConnection();

        let rtcConnection = this.rtcConnection;
        let rtcLoopbackConnection = this.rtcLoopbackConnection;
        // {"candidate":"candidate:1252570982 1 udp 2122194687 127.0.0.1 59813 typ host generation 0 ufrag Gfsv network-id 2","sdpMid":"0","sdpMLineIndex":0}
        rtcConnection.onicecandidate = e =>
        {
            e.candidate && console.log("rtcConnection", e, JSON.stringify(e.candidate.toJSON()));
            e.candidate && console.log(new RTCIceCandidate(e.candidate.toJSON()));
            e.candidate && rtcLoopbackConnection.addIceCandidate(new RTCIceCandidate(e.candidate));
        }
        rtcLoopbackConnection.onicecandidate = e =>
        {
            e.candidate && console.log("rtcLoopbackConnection", e, e.candidate.toJSON());
            e.candidate && console.log(new RTCIceCandidate(e.candidate.toJSON()));
            e.candidate && rtcConnection.addIceCandidate(new RTCIceCandidate(e.candidate));
        }
        


        rtcLoopbackConnection.ontrack = (e) => {
            console.log("rtcLoopbackConnection", e);
            e.streams[0].getTracks().forEach((track) => {
                console.log(track);
                loopbackStream.addTrack(track);
            });
        };

        rtcConnection.onconnectionstatechange = e =>{
            console.log("rtcConnection.onconnectionstatechange", e)
        }

        rtcLoopbackConnection.onconnectionstatechange = e =>{
            console.log("rtcLoopbackConnection.onconnectionstatechange", e)
        }

        rtcConnection.oniceconnectionstatechange = e =>{
            console.log("rtcConnection.oniceconnectionstatechange", e)
        }

        rtcLoopbackConnection.oniceconnectionstatechange = e =>{
            console.log("rtcLoopbackConnection.oniceconnectionstatechange", e)
        }
        
        rtcConnection.onicegatheringstatechange = e =>{
            console.log("rtcConnection.onicegatheringstatechange", e)
            if (rtcConnection.iceGatheringState === "complete") {
                const senders = rtcConnection.getSenders();
                let codecList = null;
                senders.forEach((sender) => {
                  if (sender.track.kind === "audio") {
                    codecList = sender.getParameters().codecs;
                    return;
                  }
                });

                console.log(codecList);
                // changeAudioCodec(rtcConnection, codecList, "audio/PCMA");
              }
        }

        rtcLoopbackConnection.onicegatheringstatechange = e =>{
            console.log("rtcLoopbackConnection.onicegatheringstatechange", e)
            if (rtcLoopbackConnection.iceGatheringState === "complete") {
                const senders = rtcConnection.getSenders();
                let codecList = null;
                senders.forEach((sender) => {
                  if (sender.track.kind === "audio") {
                    codecList = sender.getParameters().codecs;
                    return;
                  }
                });

                console.log(codecList);

                // changeAudioCodec(rtcLoopbackConnection, codecList, "audio/PCMA");
              }
        }
        // setup the loopback
        rtcConnection.addStream(sourcestream); // this stream would be the processed stream coming out of Web Audio API destination node

        let candidate = JSON.parse('{"candidate":"candidate:1252570982 1 udp 2122194687 127.0.0.1 59813 typ host generation 0 ufrag Gfsv network-id 2","sdpMid":"0","sdpMLineIndex":0}');
        
        console.log("---------------------\n", candidate);
        // rtcLoopbackConnection.addIceCandidate(new RTCIceCandidate(candidate));
        // rtcConnection.addIceCandidate(new RTCIceCandidate(candidate));

        // let   = [ {channels: 1, clockRate: 16000, mimeType: "audio/ISAC", payloadType: 103} ];
        // let myCodecList = [ {channels: 1, clockRate: 16000, mimeType: "audio/CN", payloadType: 105} ];
        // let myCodecList = [ {channels: 1, clockRate: 16000, mimeType: "audio/telephone-event", payloadType: 113} ];
        
        // let myCodecList = [ {channels: 2, clockRate: 48000, mimeType: "audio/opus", payloadType: 111, sdpFmtpLine: "minptime=10;useinbandfec=1"} ];

        // logHead(JSON.stringify(myCodecList));
        // {
        //     const transceivers = rtcConnection.getTransceivers();
        //     console.log("rtcConnection.transceivers",transceivers);
            
        //     transceivers.forEach(transceiver =>{
        //         try {
        //             transceiver.setCodecPreferences(myCodecList);
        //         }
        //         catch(e) {
        //             console.log(e);
        //         }
        //     })
            
        // }
        // {
        //     const transceivers = rtcLoopbackConnection.getTransceivers();
        //     console.log("rtcLoopbackConnection.transceivers",transceivers);
        //     transceivers.forEach(transceiver =>{
        //         try {
        //             transceiver.setCodecPreferences(myCodecList);
        //         }
        //         catch(e) {
        //             console.log(e);
        //         }
        //     })
        // }

        offer = await rtcConnection.createOffer(offerOptions);
        offer.sdp = offer.sdp.replace('SAVPF 111', 'SAVPF 10 111');
        offer.sdp = offer.sdp.replace('a=rtpmap:111 opus/48000/2', 'a=rtpmap:10 L16/16000\na=rtpmap:111 opus/48000/2');
        console.log("offer SDP", offer.sdp);

        await  rtcConnection.setLocalDescription(offer);
        await  rtcLoopbackConnection.setRemoteDescription(offer);

        answer = await  rtcLoopbackConnection.createAnswer();
        answer.sdp = answer.sdp.replace('SAVPF 111', 'SAVPF 10 111');
        answer.sdp = answer.sdp.replace('a=rtpmap:111 opus/48000/2', 'a=rtpmap:10 L16/16000\na=rtpmap:111 opus/48000/2');
        console.log("answer SDP", answer.sdp);

        await  rtcLoopbackConnection.setLocalDescription(answer);
        await  rtcConnection.setRemoteDescription(answer);

        //end rtcloopbackhack.js
        this.rtcConnectionA = rtcConnection;
        this.rtcConnectionB = rtcLoopbackConnection;

        console.log(rtcConnection, rtcLoopbackConnection);
        console.log(rtcConnection.getConfiguration(), rtcLoopbackConnection.getConfiguration());
        return loopbackStream;
    }
}

function formatStr() {
    let str = "";
    for (let i = 0;i < arguments.length;i ++) {
        str += arguments[i];
    }
    str += "\n"
    return str;
}


function RingBuffer(frameSize) {
    this.block = new Float32Array(frameSize);
    this.frameSize = frameSize;
    this.blockSize = 0;
    this.queue = [];
}

RingBuffer.prototype.read_some = function() {
    if (this.queue.length === 0) {
        return null;
    }
    var buff = this.queue.shift();
    return new Uint8Array(buff.buffer);
}

RingBuffer.prototype.readAsFloat32 = function() {
    if (this.queue.length === 0) {
        return null;
    }
    return this.queue.shift();
}

RingBuffer.prototype.append = function(buff){
    while( (buff = this._append (buff)) !== null ) {}
}

RingBuffer.prototype._append = function(buff){
    if (this.blockSize + buff.length < this.block.length) {
        this.block.set(buff, this.blockSize);
        this.blockSize += buff.length;
        return null;
    } else if (this.blockSize + buff.length === this.block.length) {
        this.block.set(buff, this.blockSize);
        this.queue.push(this.block);
        this.block = new Float32Array(this.frameSize);
        this.blockSize = 0;
        return null;
    }else {
        let remain = this.block.length - this.blockSize;
        this.block.set(buff.subarray(0, remain), this.blockSize, this.block.length);
        this.queue.push(this.block);
        this.block = new Float32Array(this.frameSize);
        this.blockSize = 0;
        return buff.subarray(remain);
    }
}

RingBuffer.prototype.clear = function () {

};

RingBuffer.prototype.capacity = function () {

};

RingBuffer.prototype.size = function () {
    return this.queue.length;
};

RingBuffer.prototype.available = function () {

};

function log() {
    text.value = text.value + formatStr.apply(null, arguments);
}

function logHead() {
    text.value = formatStr.apply(null, arguments) + text.value ;
}

var text = document.getElementById("text");

let audioTest = null;

function Click(o) {
    let buttons = document.querySelectorAll("button.selected");
    buttons.forEach(e => {
        e.className = "";
    })
    console.log(buttons)
    o.className = "selected";
    console.log(o, o.id);

    switch(o.id)
    {
        case "0":
            UseAudioOnly();
            break;
        case "1":
            EnableAec();
            break;
        case "2":
            UsePeerConn();
            break;
        case "3":
            stop();
            break;
        case "4":
            UseWorklet();
            break;
        case "5":
            UseWorkletAndPeerConn();
            break;
    }
}


function UseAudioOnly() {
    if (audioTest) audioTest.stop();

    audioTest = new AudioTest(log,{noiseSuppression : false, echoCancellation:false, autoGainControl:false},false,false);

    audioTest.start();
}

function UseWorklet() {
    if (audioTest) audioTest.stop();

    audioTest = new AudioTest(log,{noiseSuppression : false, echoCancellation:false, autoGainControl:false},false,true);

    audioTest.start();
}

function UseWorkletAndPeerConn() {
    if (audioTest) audioTest.stop();

    audioTest = new AudioTest(log,{noiseSuppression : false, echoCancellation:false, autoGainControl:false},true,true);

    audioTest.start();
}

function EnableAec() {
    if (audioTest) audioTest.stop();
    
    audioTest = new AudioTest(log,{noiseSuppression : true, echoCancellation:true, autoGainControl:true},false, true);
 
    audioTest.start();
}

function UsePeerConn() {
    if (audioTest) audioTest.stop();
    
    audioTest = new AudioTest(log,{noiseSuppression : true, echoCancellation:true, autoGainControl:true},true, true);

    audioTest.start();
}

function stop() {
    if (audioTest) audioTest.stop();
    audioTest = null;
}