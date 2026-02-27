'use strict';

/**
 * MulticastService.js
 *
 * UDP multicast send/receive using Node.js built-in dgram.
 *
 * On start():
 *   - Creates a UDP socket
 *   - Binds to the multicast port on 0.0.0.0
 *   - Joins the multicast group
 *   - Emits received datagrams via onMessage callback
 *
 * On send():
 *   - Sends bytes to the configured multicast group:port
 */

const dgram = require('dgram');

class MulticastService {
  /**
   * @param {string} multicastGroup
   * @param {number} port
   * @param {(data: Uint8Array, rinfo: {address: string, port: number}) => void} onMessage
   * @param {(msg: string, level?: 'info'|'warn'|'error') => void} [onLog]
   */
  constructor(multicastGroup, port, onMessage, onLog) {
    this.multicastGroup = multicastGroup;
    this.port = port;
    this.onMessage = onMessage;
    this.onLog = onLog || (() => {});
    this._socket = null;
    this._active = false;
  }

  get isActive() {
    return this._active;
  }

  /**
   * Start listening on the multicast group.
   * Creates socket, binds to port, joins multicast group.
   * @returns {Promise<void>}
   */
  start() {
    return new Promise((resolve, reject) => {
      if (this._active) {
        resolve();
        return;
      }

      this._socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

      this._socket.once('error', (err) => {
        this.onLog(`UDP socket error: ${err.message}`, 'error');
        reject(err);
      });

      this._socket.once('listening', () => {
        try {
          this._socket.addMembership(this.multicastGroup);
          this.onLog(`Joined multicast group ${this.multicastGroup}`);
        } catch (e) {
          this.onLog(`addMembership failed: ${e.message}`, 'warn');
          // Non-fatal – we may still receive unicast packets
        }

        this._active = true;
        this.onLog(`UDP listening on ${this.multicastGroup}:${this.port}`);
        resolve();
      });

      this._socket.on('message', (data, rinfo) => {
        this.onMessage(new Uint8Array(data), rinfo);
      });

      this._socket.bind(this.port, '0.0.0.0');
    });
  }

  /**
   * Send bytes to the multicast group.
   * @param {Uint8Array} bytes
   * @returns {Promise<void>}
   */
  send(bytes) {
    return new Promise((resolve, reject) => {
      if (!this._socket || !this._active) {
        reject(new Error('MulticastService is not running'));
        return;
      }

      const buf = Buffer.from(bytes);
      this._socket.send(buf, 0, buf.length, this.port, this.multicastGroup, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Stop listening and close the socket.
   */
  stop() {
    if (!this._active) {
      return;
    }

    try {
      this._socket.dropMembership(this.multicastGroup);
    } catch {
      // Ignore errors on cleanup
    }

    try {
      this._socket.close();
    } catch {
      // Ignore errors on cleanup
    }

    this._socket = null;
    this._active = false;
    this.onLog('UDP multicast stopped.');
  }

  /**
   * Update multicast group and port (requires restart to take effect).
   * @param {string} group
   * @param {number} port
   */
  updateConfig(group, port) {
    const wasActive = this._active;
    if (wasActive) {
      this.stop();
    }
    this.multicastGroup = group;
    this.port = port;
    if (wasActive) {
      this.start().catch((err) => {
        this.onLog(`Multicast restart error: ${err.message}`, 'error');
      });
    }
  }
}

module.exports = { MulticastService };
