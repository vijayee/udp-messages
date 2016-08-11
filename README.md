#UDP Messenger
This is a library to send messages over udp. Messages are broken into chunks and reorganized on the other side.
There is a loose detection of failures and messages will attempt to resend themselves upon failure.
```javascript
const Messenger = require('udp-messenger')

let messenger = new Messenger(2000, 54000, 512) // timeout, port, packet size (must be greater than 26 bytes)
messenger.on('message', (msg)=>{}) // when a message is received
messenger.on('listening', ()=>{}) //when a messenger begins listening
messenger.on('error', (err)=>{}) // when an error occurs
messenger.on('sent', (msg)=>{}) // when a message is sent
messenger.on('failure', (msg)=>{}) // when a failure to receive a message occurs
messenger.on('dropped', (msg)=>{}) // when a message cannot be resent
messenger.listen()// start listening for messages
messenger.send(new Buffer("Hello World!") , '192.168.1.3', 52000) //send a message (buffer, host, port)
messenger.close(()=>{}) // stop listening

```
##license
ISC