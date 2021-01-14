var MetaWear = require('metawear');
var winston = require('winston');
var moment = require("moment");
var ref = require("ref");
var util = require("util");
var path = require('path');
const fs = require('fs')
const FormData = require('form-data')
const axios = require('axios')
const DataCapture = require('./data-capture.js');
const BleConn = require('./ble-conn.js')
const SensorConfig = require('./sensor-config.js')

const express = require('express')
const app = express()
const expressWs = require('express-ws')(app)

let rotationsRead = {}
let emgBuffer = {v:[],t:[]}

const startTime = Date.now()
const emgSample = 22
const dispositivos = 4
const { spawn } = require('child_process')
const python = spawn('stdbuf', ['-oL', '-eL', 'python', './python/emg_hachi.py'])
let pythonBuffer = ''

let grabando = false
let grabacionEMG = Array(1000000).fill(0)
let iEMG = 0
let grabacionIMU = Array(1000000).fill(0)
let iIMU = 0
let enviado = false
//const stream = fs.createWriteStream('stream.txt', { flags: 'a' })

let tiempo = Date.now()
let count = 0
python.stdout.on('data', data => {
  if (data) {
    pythonBuffer  += `${data}`
    if (Date.now() > tiempo + emgSample) {
      tiempo = tiempo + emgSample
      emgBuffer.v = [
        ...emgBuffer.v,
        ...pythonBuffer
          .split('\n')
          .slice(1, -1)
          .filter(s => s)
      ]
      if (grabando) {
         grabacionEMG[iEMG++] = pythonBuffer
             .split('\n')
             .slice(1, -1)
             .filter(s => s)
      }
      pythonBuffer = pythonBuffer.slice(pythonBuffer.lastIndexOf('\n'))
    }
  }
})

const maximo = lineas => {
  return lineas
    .map(v => v.split(',').map(Number))
    .reduce((x, y) => [
      Math.max(x[0], y[0]),
      Math.max(x[1], y[1]),
      Math.max(x[2], y[2]),
      Math.max(x[3], y[3])
  ], [0, 0, 0, 0]).join(',')
}
  
const WebSocket = require('ws')
const ws = new WebSocket('wss://compsci.cl:2304/input')
ws.on('open', function open() {
  winston.info('Conexión con servidor WSS exitosa')
  ws.send(JSON.stringify({ r: rotationsRead, e: emgBuffer, t: Date.now() }))
})
ws.on('message', function (msg) {
  if (msg.startsWith('false')) {
    grabando = false
    const [[_, id], macTronco, macHombro, macCodo, macMuñeca, correcciones] = [
      msg.split('|')[0].split(','),
      ...msg.split('|').slice(1)
    ]
    if (id && !enviado && grabacionEMG.length > 0) {
      //stream.end()
      console.log('enviando a strapi...', id)
      console.log('Datos EMG:', grabacionEMG.filter(v => v).length)
      console.log('Datos IMU:', grabacionIMU.filter(v => v).length)
      grabacionEMG = [].concat(...grabacionEMG.filter(v=>v))
      grabacionIMU = grabacionIMU.filter(v => v)
      console.log('total de datos', grabacionEMG.length)
      const o = {
        query: `
            mutation upload($file: Upload!) {
              upload(file: $file) {
                id
              }
            }
           `,
        variables: {
          file: null
        }
      }
      let map = {
        '0': ['variables.file']
      }
      let fd = new FormData()
      fd.append('operations', JSON.stringify(o))
      fd.append('map', JSON.stringify(map))
      fd.append('0', Buffer.from(JSON.stringify({
        grabacionEMG,
        grabacionIMU,
        macs: { macTronco, macHombro, macCodo, macMuñeca },
        correcciones: JSON.parse(correcciones)
      })),'datos.json')
      axios.post(
        'https://compsci.cl/ept/graphql',
        fd, 
        {
          headers: { ...fd.getHeaders() },
          maxContentLength: Infinity,
          maxBodyLength: Infinity
        }
      )
      .then(res => {
        console.log(res.data)
        const uploadId = res.data.data.upload.id
        console.log({id, uploadId})
        axios.post(
          'https://compsci.cl/ept/graphql',
          {
            "operationName":"Editar",
            "variables":{
              id,
              uploadId
            },
            "query": `
              mutation Editar($id: ID!, $uploadId: ID!) {
                updateRegistroEpt(input: {
                  where: {
                    id: $id
                  },
                  data: {
                    datos_emg: $uploadId
                  }
                }) {
                  registroEpt {
                    id
                  }
                }
              }
            `
          }
        )
      })
      .then(() => {
        console.log('Datos enviados exitosamente.')
        console.log('Presione ENTER para terminar sesión.')
      })
      .catch(e => console.log(e.message))
      enviado = true
      grabacionEMG = Array(1000000).fill(0)
      grabacionIMU = Array(1000000).fill(0)
    }
  } 
  else {
    grabando = true
  }
  //console.log(msg)
  ws.send(JSON.stringify({ r: rotationsRead, e: {v:[maximo(emgBuffer.v)], t:[emgBuffer.t[0]]}, t: Date.now() }))
  emgBuffer = { v: [], t: [] }
})
ws.on('error', () => {
  winston.error('Error en la conexión WSS. Revise su conexión con internet.')
})

var createWindow = undefined
async function start(options, config, cache, cacheFile) {
  var sessions = [];
  var states = [];
  var devices = [];
  let conexionesExitosas = 0

  for(let d of config['devices']) {
    if (dispositivos === conexionesExitosas) {
      winston.info(`Ya me conecté con ${dispositivos} dispositivos`)
      break
    }
    winston.info("Conectando con dispositivo", { 'mac': d['mac'] });
    try {
        let device = await BleConn.findDevice(d['mac']);
        await BleConn.connect(device, true, cache);
        await BleConn.serializeDeviceState(device, cacheFile, cache)
        
        device.once('disconnect', BleConn.onUnexpectedDisconnect)
        devices.push([device, 'name' in d ? d['name'] : 'MetaWear']);
        conexionesExitosas++
    } catch (e) {
        winston.warn('Conexión falló con dispositivo', {'mac': d['mac']});
    }
  }

  if (!devices.length) {
    winston.error("No me conecté con ningún dispositivo, cerrando app");
    process.exit(0);
    return;
  }

  await new Promise((resolve, reject) => setTimeout(() => resolve(null)), 1000);

  winston.info("Configurando dispositivos")
  var now = moment().format("YYYY-MM-DDTHH-mm-ss.SSS");
  var x = -1, y = 0;
  for(let it of devices) {
    let d = it[0]

    var session = undefined;
    if ('cloudLogin' in config) {
        session = DataCapture.prepareMetaCloud(d, it[1]);
        sessions.push(session);
    }

    let current_states = []
    let sensors = [];
    for(let s of Object.keys(config['sensors'])) {
      if (!(s in SensorConfig)) {
        winston.warn(util.format("'%s' is not a valid sensor name", s));
      } else if (!SensorConfig[s].exists(d.board)) {
        winston.warn(util.format("'%s' does not exist on this board", s), { 'mac': d.address });
      } else {
        let options = {
          csv: {
            name: it[1],
            root: config['csv'],
            now: now,
            address: d.address,
          }
        }
        if (session !== undefined) {
          options['metacloud'] = session;
        }
        let state = await DataCapture.createState((handler) => MetaWear.mbl_mw_datasignal_subscribe(SensorConfig[s].signal(d.board, true), ref.NULL, handler), s, options);
        
        state['update-graph'] = data => {
          rotationsRead[d.address] = data.map(v => Math.round(v * 10000) / 10000)
          if (grabando) {
            //stream.write(JSON.stringify([d.address, ...rotationsRead[d.address], Date.now()]) + '\n')
            grabacionIMU[iIMU++] = [d.address, ...rotationsRead[d.address], Date.now()]
          }
        }
        
        current_states.push(state)
        states.push(state);
        sensors.push(s);
      }
    };

    if (sensors.length != 0) {
      if (createWindow !== undefined) {
        let sizes = {
          'width': options['electron'].screen.getPrimaryDisplay().size.width,
          'height': options['electron'].screen.getPrimaryDisplay().size.height
        };
        if (!('resolution' in config)) {
          config["resolution"] = { }
        }
        if (!('width' in config['resolution']) || config['resolution']['width'] == null) {
          config['resolution']['width'] = sizes['width'] / 2
        }
        if (!('height' in config['resolution']) || config['resolution']['height'] == null) {
          config['resolution']['height'] = sizes['height'] / 2
        }

        if (x < 0) {
          x = sizes['width'] - config['resolution']['width'];
        }
        //createWindow(current_states, config['fps'], d.address, it[1], sensors.map(s => `${s}=${SensorConfig[s].odrToMs(config["sensors"][s])}`), config['resolution'], x, y)

        x -= config['resolution']['width'];
        if (x < 0) {
          y += config['resolution']['height'];
          if (y >= sizes['height']) {
              y = 0;
          }
        }
      }
      for(let s of sensors) {
          await SensorConfig[s].configure(d.board, config["sensors"][s]);
          SensorConfig[s].start(d.board);
      }
    } else {
        winston.warn("No sensors were enabled for device", { 'mac': d.address })
    }
  }
  
  if (states.length == 0) {
      winston.error("No active sensors to receive data from, terminating app")
      return;
  }
  process.openStdin().addListener("data", async data => {
    winston.info("Desconectando dispositivos...");
    python.kill('SIGINT')
    Promise.all(devices.map(d => {
      if (d[0]._peripheral.state !== 'connected') {
        return Promise.resolve(null);
      }
      d[0].removeListener('disconnect', BleConn.onUnexpectedDisconnect);
      var task = new Promise((resolve, reject) => d[0].once('disconnect', () => resolve(null)))
      MetaWear.mbl_mw_debug_reset(d[0].board)
      return task
    })).then(async results => {
      states.forEach(s => s['csv'].end());

      if ('cloudLogin' in config) {
        winston.info("Syncing data to MetaCloud");
        for(let s of sessions) {
          try {
            await new Promise((resolve, reject) => {
              s.sync(config['cloudLogin']['username'], config['cloudLogin']['password'], (error, result) => {
                if (error == null) resolve(result)
                else reject(error);
              });
            });
          } catch (e) {
            winston.warn("Could not sync data to metacloud", { 'error': e });
          }
        }
        winston.info("Syncing completed");
      }
      process.exit(0)
    })
  });
  winston.info("Recibiendo datos desde dispositivos");
  winston.info("Presiona [Enter] para salir...");
}

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
var windows = {};

module.exports = (config, noGraph, cache, cacheFile) => {
  if (!('devices' in config) || !('sensors' in config)) {
    winston.error("'--device' & '--sensor' options must be used, or 'device' and 'sensor' keys must be set in config file");
    process.exit(1);
    return
  }
  start({}, config, cacheFile, cacheFile);

  /*if (!noGraph) {
    const electron = require('electron')
    // Module to control application life.
    const app = electron.app
    // Module to create native browser window.
    const BrowserWindow = electron.BrowserWindow
    const url = require('url')

    let options = {
        'electron': electron
    }
    app.on('window-all-closed', function () {
    });
    app.on('browser-window-created',function(e,window) {
        window.setMenu(null);
    });

    createWindow = (states, fps, mac, title, sensors, resolution, x, y) => {
      let attr = Object.assign({title: `${title} (${mac.toUpperCase()})`, x: x, y: y}, resolution);
      // Create the browser window.
      let newWindow = new BrowserWindow(attr)
      windows[mac] = newWindow;
    
      // and load the index.html of the app.
      newWindow.loadURL(url.format({
        pathname: path.join(__dirname, '..', 'views', 'index.html'),
        protocol: 'file:',
        slashes: true,
        search: `fps=${fps}&mac=${mac}&sensors=${sensors.join(',')}&width=${resolution['width']}&height=${resolution['height']}`
      }))
    
      // Open the DevTools.
      // mainWindow.webContents.openDevTools()
    
      // Emitted when the window is closed.
      newWindow.on('closed', function () {
        winston.info("Window closed, data is still being written to the CSV file", { 'mac': mac })
        states.forEach(s => s['update-graph'] = (data) => {})
        delete windows[mac]
        // Dereference the window object, usually you would store windows
        // in an array if your app supports multi windows, this is the time
        // when you should delete the corresponding element.
        newWindow = null
      })
    
      newWindow.on('resize', () => newWindow.webContents.send(`resize-${mac}` , newWindow.getSize()));
    }
    
    app.on('ready', () => start(options, config, cache, cacheFile));
  } else {
    start({}, config, cacheFile, cacheFile);
  }*/
}

process.on('SIGINT', () => {
  console.log('no hago nada')
})