'use strict'
const ReceiveMessage = require('./receive-message')
const SendMessage = require('./send-message')
const fs = require('fs')
const path = require('path')
const file = path.join(__dirname, 'message.proto')
const msgproto = fs.readFileSync(file)
const protobuf = require('protocol-buffers')
const pb = protobuf(msgproto)
const udp = require('dgram')
const EventEmitter = require('events').EventEmitter
let _messageBox = new WeakMap()
let _socket = new WeakMap()
let _retry = new WeakMap()
let _port = new WeakMap()
let _onsent = new WeakMap()
let _onfailure = new WeakMap()
let _onreceived = new WeakMap()
let _onresent = new WeakMap()
let _packetSize = new WeakMap()
let _timeout = new WeakMap()
let _timers = new WeakMap()
class Messenger extends EventEmitter {
  constructor (timeout, port, packetSize) {
    super()
    this._maxListeners = 0
    timeout = timeout || 2000
    port = port || 5000
    packetSize = packetSize || 512
    if(isNaN(timeout)){
      throw new Error("Invalid Timeout")
    }
    if(isNaN(port)){
      throw new Error("Invalid Port")
    }
    if(isNaN(packetSize)){
      throw new Error("Invalid Packet Size")
    }
    _messageBox.set(this, new Map())
    _timers.set(this, new Map())
    _retry.set(this, new Map())
    _port.set(this, port)
    _packetSize.set(this, packetSize)
    _timeout.set(this, timeout)
    let socket = udp.createSocket('udp4')
    _socket.set(this, socket)
    let onresent = (msg)=> {
      let timers = _timers.get(this)
      let id = msg.msgId.toString('hex')
      let timeout = _timeout.get(this)
      let removeRetry = ()=> {
        let retry = _retry.get(this)
        let timers = _timers.get(this)
        let messageBox = _messageBox.get(this)
        let message = messageBox.get(id)
        if (message) {
          message.emit('sent', { msgId: msg.msgId })
        }
        retry.delete(id)
        timers.delete(id)
        _retry.set(this, retry)
        _timers.set(this, timers)
      }
      let timer
      if (timers.has(id)) {
        timer = timers.get(id)
        clearTimeout(timer)
      }
      timer = setTimeout(removeRetry, timeout)
      timers.set(id, timer)
      _timers.set(this, timers)
    }
    _onresent.set(this, onresent)

    let onreceived = (message)=> {
      this.emit('message', message.message)
    }
    _onreceived.set(this, onreceived)

    let onmessage = (msg, rinfo)=> {
      let part
      try {
        part = pb.msg.decode(msg)
        if (!part) {
          throw new Error('Invalid Message')
        }
      } catch (ex) {
        this.emit('error', ex)
        return
      }
      let messageBox = _messageBox.get(this)
      let id = part.msgId.toString('hex')
      let message = messageBox.get(id)
      if (!message) {
        if (!part.payload) {
          this.emit('dropped', { msgId: part.msgId })
          return
        }
        let timeout = _timeout.get(this)
        message = new ReceiveMessage(rinfo, timeout)
        let onreceived = _onreceived.get(this)
        let onfailure = _onfailure.get(this)
        message.on('received', onreceived)
        message.on('failure', onfailure)
      } else {
        if (!part.payload) {
          //retry case
          let retry = _retry.get(this)
          let onresent = _onresent.get(this)
          if (!retry.has(id)) {
            retry.set(id, message)
          }
          let socket = _socket.get(this)
          message.on('resent', onresent)
          message.reSend(socket, rinfo.address, rinfo.port, part.index)
          return
        }
      }

      message.receive(part)
      messageBox.set(id, message)
    }
    socket.on('message', onmessage)
    let onerror = (err)=> {
      this.emit('error', err)
    }
    socket.on('error', onerror)
    let onlistening = ()=> {
      this.emit('listening')
    }
    socket.on('listening', onlistening)

    let onsent = (message)=> {
      let id = message.msgId.toString('hex')
      let retry = _retry.get(this)
      retry.delete(id)
      _retry.set(this, retry)
      setTimeout(()=> {
        let retry = _retry.get(this)
        if (!retry.has(id)) {
          let messageBox = _messageBox.get(this)
          messageBox.delete(id)
          messageBox.set(this, messageBox)
        }
      }, timeout + 1000)
      this.emit('sent', message)
    }
    _onsent.set(this, onsent)
    let onfailure = (failure) => {
      let onsent = _onsent.get(this)
      let socket = _socket.get(this)
      let packetSize = _packetSize.get(this)
      let timeout = _timeout.get(this)
      SendMessage.sendFailure(failure, socket, (err)=> {
        if (err) {
          this.emit('error', err)
          return
        }
        this.emit('failure', { msgId: failure.msgId })
      })
    }
    _onfailure.set(this, onfailure)

  }

  listen () {
    let socket = _socket.get(this)
    let port = _port.get(this)
    socket.bind(port)
  }

  close (cb) {
    let socket = _socket.get(this)
    let port = _port.get(this)
    socket.close(cb)
  }

  send (buf, host, port) {
    if (!Buffer.isBuffer(buf) || buf.length === 0) {
      throw new Error("Invalid Message Buffer")
    }
    let messageBox = _messageBox.get(this)
    let onsent = _onsent.get(this)
    let socket = _socket.get(this)
    let packetSize = _packetSize.get(this)
    let timeout = _timeout.get(this)
    let message = new SendMessage(buf, timeout, packetSize)
    message.on('sent', onsent)
    message.on('ready', ()=> {
      let id = message.msgId.toString('hex')
      this.emit('sending', { msgId: message.msgId })
      messageBox.set(id, message)
      message.send(socket, host, port)
    })
  }

}
module.exports = Messenger