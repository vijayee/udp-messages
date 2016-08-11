'use strict'
const EventEmitter = require('events').EventEmitter
let _chunks = new WeakMap()
let _length = new WeakMap()
let _received = new WeakMap()
let _msgId = new WeakMap()
let _lastReceived = new WeakMap()
let _timeoutId= new WeakMap()
let _rinfo= new WeakMap()
let _timeout= new WeakMap()

class ReceiveMessage extends EventEmitter {
  constructor (rinfo, timeout) {
    super()
    this._maxListeners = 0
    if (isNaN(timeout)) {
      throw new Error("Invalid Timeout")
    }
    _timeout.set(this, timeout)
    _chunks.set(this, [])
    _received.set(this, 0)
    _rinfo.set(this, rinfo)
    _length.set(this, 0)
  }

  get msgId () {
    let msgId = _msgId.get(this)
    if (msgId) {
      return _msgId.get(this).slice(0)
    } else {
      return null
    }
  }
  get rinfo () {
    return _rinfo.get(this)
  }
  get length(){
    return _length.get(this)
  }

  receive (part) {
    let timeoutId =_timeoutId.get(this)
    if(timeoutId){
      clearTimeout(timeoutId)
    }
    let chunks = _chunks.get(this)
    let msgId = _msgId.get(this)
    let received = _received.get(this)
    if (!msgId) {
      _msgId.set(this, part.msgId)
    } else {
      if (msgId.compare(part.msgId) !== 0) {
        this.emit(new Error("Message ID does not match this message"))
      }
    }
    let length = _length.get(this)
    if (!length) {
      length = part.length
      _length.set(this, length)
    }
    chunks[ part.index ] = part.payload
    received++
    _received.set(this, received)
    _lastReceived.set(this, new Date())
    let timeout = _timeout.get(this)
    timeoutId= setTimeout(()=> {
      let length = _length.get(this)
      let received = _received.get(this)
      if (received < length) {
        let lastReceived = _lastReceived.get(this)
        let now = new Date()
        let diff = now.getTime() - lastReceived.getTime()
        if (diff >= timeout) {
          let chunks = _chunks.get(this)
          let failures = []
          for(let i= 0; i < this.length; i++){
            if(!chunks[i]){
              failures.push(i)
            }
          }
          this.emit('failure', {msgId: this.msgId, rinfo: this.rinfo, length: length ,failures: failures})
        }
      }
    }, timeout)
    _timeoutId.set(this, timeoutId)
    if (received === length) {
      let message = Buffer.concat(chunks)
      this.emit('received', {msgId: this.msgId, message: message})
    }
  }
}

module.exports = ReceiveMessage