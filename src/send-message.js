'use strict'
const fs = require('fs')
const msgproto = fs.readFileSync('./src/message.proto')
const protobuf = require('protocol-buffers')
const pb = protobuf(msgproto)
const crypto = require('crypto')
const blocker = require('block-stream2')
const through = require('through2')
const streamifier = require('streamifier')
const EventEmitter = require('events').EventEmitter
const _minSize = 26
let _msgId = new WeakMap()
let _chunks = new WeakMap()
let _timeout = new WeakMap()

class SendMessage extends EventEmitter {
  constructor (buf, timeout, packetSize) {
    super()
    this._maxListeners = 0
    if (!Buffer.isBuffer(buf)) {
      throw new Error("Invalid Buffer")
    }
    if (isNaN(timeout)) {
      throw new Error("Invalid Timeout")
    }
    _timeout.set(this, timeout)
    if (!packetSize) {
      packetSize = 512
    }
    if (isNaN(packetSize)) {
      throw new Error("Invalid Packet Size")
    }
    if (packetSize <= _minSize) {
      throw new Error("Package Size Too Small")
    }
    let chunks = []
    let bufStream = streamifier.createReadStream(buf)
    let msgId = crypto.randomBytes(2)
    _msgId.set(this, msgId)
    bufStream.pipe(blocker({ size: (packetSize - _minSize), zeroPadding: false }))
      .pipe(through((buf, enc, next)=> {
        chunks.push(buf)
        return next()
      }))
      .on('finish', ()=> {
        _chunks.set(this, chunks)
        this.emit('ready')
      })

  }

  get msgId () {
    let msgId = _msgId.get(this)
    if (msgId) {
      return msgId.slice(0)
    } else {
      return null
    }
  }

  get length () {
    return _chunks.get(this).length
  }

  send (socket, host, port) {
    let chunks = _chunks.get(this)
    let msgId = _msgId.get(this)
    let i = -1
    let next = (err)=> {
      if (err) {
        return this.emit('error', err)
      }
      i++

      if (i < chunks.length) {
        let part = {
          msgId: msgId,
          index: i,
          length: chunks.length,
          payload: chunks[ i ]
        }
        try {
          let message = pb.msg.encode(part)
          socket.send(message, port, host, next)
        } catch (ex) {
          this.emit('error', ex)
        }
      } else {
        this.emit('sent', { msgId: msgId })
      }
    }
    next()
  }

  static sendFailure (failure, socket, cb) {
    if (!cb) {
      cb = noop
    }
    let i = -1
    let next = (err)=> {
      if (err) {
        return this.emit('error', err)
      }
      i++
      if (i < failure.failures.length) {
        let part = {
          msgId: failure.msgId,
          index: failure.failures[ i ],
          length: failure.length
        }
        try {
          let message = pb.msg.encode(part)
          socket.send(message, failure.rinfo.port, failure.rinfo.address, next)
        } catch (ex) {
          return cb(ex)
        }
      }
    }
    next()
  }

  reSend (socket, host, port, index) {
    let chunks = _chunks.get(this)
    let msgId = _msgId.get(this)
    let part = {
      msgId: msgId,
      index: index,
      length: chunks.length,
      payload: chunks[ index ]
    }
    let msg
    try {
      msg = pb.msg.encode(part)
    } catch (ex) {
      this.emit('error', ex)
    }
    socket.send(msg, port, host, ()=> {
      this.emit('resent', { msgId: msgId, index: index })
    })
  }
}
function noop () {}
module.exports = SendMessage