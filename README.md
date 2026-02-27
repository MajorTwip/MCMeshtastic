# MCMeshtastic

Meshtastic &lt;-&gt; UDP Multicast Bridge — plain Node.js, no GUI.

Bridges a [Meshtastic](https://meshtastic.org/) device (connected via Bluetooth LE) to a UDP multicast group on the local network, forwarding packets in both directions.

## Requirements

- Node.js 18+
- Linux / macOS with a Bluetooth adapter (uses [@abandonware/noble](https://github.com/abandonware/noble))
- On Linux: `libbluetooth-dev` (Debian/Ubuntu: `sudo apt install libbluetooth-dev`)

## Install

```sh
npm install
```

## Usage

```sh
# Auto-scan for the first Meshtastic device, use default multicast group
node index.js

# Specify a known device ID directly (skip scan)
node index.js --device <BLE_DEVICE_ID>

# Custom multicast settings
node index.js --multicast-group 239.0.0.1 --multicast-port 4403

# All options
node index.js --help
```

### Options

| Option | Default | Description |
|---|---|---|
| `--device <id>` | *(scan)* | BLE device ID (skip scan) |
| `--multicast-group <ip>` | `224.0.0.251` | UDP multicast group |
| `--multicast-port <port>` | `5353` | UDP port |
| `--scan-duration <ms>` | `15000` | BLE scan duration |

### Environment variables

| Variable | Description |
|---|---|
| `BLE_DEVICE_ID` | Device ID (same as `--device`) |
| `MULTICAST_GROUP` | Multicast IP (same as `--multicast-group`) |
| `MULTICAST_PORT` | UDP port (same as `--multicast-port`) |
| `SCAN_DURATION` | Scan duration ms (same as `--scan-duration`) |

## Architecture

```
UDP Multicast (224.0.0.251:5353)
       │                        ▲
       │ dgram                  │ dgram
       ▼                        │
  MulticastService         MulticastService
       │                        │
       │  BridgeService         │
       │  (encode MeshPacket)   │ (decode MeshPacket)
       │                        │
       ▼                        │
  BluetoothService         BluetoothService
       │ noble                  │ noble
       ▼                        │
  Meshtastic Node  ──[mesh]──►  │
```

## Tests

```sh
npm test
```

