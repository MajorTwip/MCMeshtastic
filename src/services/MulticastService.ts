/**
 * MulticastService.ts
 *
 * UDP multicast send/receive using react-native-udp.
 *
 * On start():
 *   - Creates a UDP socket
 *   - Adds multicast membership (via NativeModules.UdpMulticastModule on Windows)
 *   - Binds to the multicast port on 0.0.0.0
 *   - Emits received datagrams via onMessage callback
 *
 * On send():
 *   - Sends bytes to the configured multicast group:port
 */

import dgram from 'react-native-udp';
import {NativeModules, Platform} from 'react-native';
import type {Socket} from 'react-native-udp';

export type MessageCallback = (data: Uint8Array, rinfo: {address: string; port: number}) => void;
export type LogCallback = (msg: string, level?: 'info' | 'warn' | 'error') => void;

export class MulticastService {
  private socket: Socket | null = null;
  private multicastGroup: string;
  private port: number;
  private onMessage: MessageCallback;
  private onLog: LogCallback;
  private active = false;

  constructor(
    multicastGroup: string,
    port: number,
    onMessage: MessageCallback,
    onLog: LogCallback = () => {},
  ) {
    this.multicastGroup = multicastGroup;
    this.port = port;
    this.onMessage = onMessage;
    this.onLog = onLog;
  }

  get isActive(): boolean {
    return this.active;
  }

  /**
   * Start listening on the multicast group.
   * Creates socket, joins multicast group, binds to port.
   */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.active) {
        resolve();
        return;
      }

      this.socket = dgram.createSocket({type: 'udp4', reusePort: true});

      this.socket.once('error', (err: Error) => {
        this.onLog(`UDP socket error: ${err.message}`, 'error');
        reject(err);
      });

      this.socket.once('listening', () => {
        const sock = this.socket!;

        // Join the multicast group
        try {
          if (Platform.OS === 'windows' && NativeModules.UdpMulticastModule) {
            // Use Windows native module for multicast membership
            NativeModules.UdpMulticastModule.addMembership(
              this.multicastGroup,
              '0.0.0.0',
            );
          } else {
            // react-native-udp provides addMembership on other platforms
            (sock as unknown as {addMembership: (g: string) => void}).addMembership(
              this.multicastGroup,
            );
          }
          this.onLog(`Joined multicast group ${this.multicastGroup}`);
        } catch (e) {
          const err = e as Error;
          this.onLog(`addMembership failed: ${err.message}`, 'warn');
          // Non-fatal – we may still receive unicast packets
        }

        this.active = true;
        this.onLog(`UDP listening on ${this.multicastGroup}:${this.port}`);
        resolve();
      });

      this.socket.on('message', (data: Buffer, rinfo: {address: string; port: number}) => {
        this.onMessage(new Uint8Array(data), rinfo);
      });

      // Bind to the multicast port on all interfaces
      this.socket.bind(this.port, '0.0.0.0');
    });
  }

  /**
   * Send bytes to the multicast group.
   */
  send(bytes: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.active) {
        reject(new Error('MulticastService is not running'));
        return;
      }

      const buf = Buffer.from(bytes);
      this.socket.send(buf, 0, buf.length, this.port, this.multicastGroup, (err?: Error | null) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Stop listening and close socket.
   */
  stop(): void {
    if (!this.active) {
      return;
    }

    try {
      if (Platform.OS === 'windows' && NativeModules.UdpMulticastModule) {
        NativeModules.UdpMulticastModule.dropMembership(
          this.multicastGroup,
          '0.0.0.0',
        );
      } else if (this.socket) {
        (this.socket as unknown as {dropMembership: (g: string) => void}).dropMembership?.(
          this.multicastGroup,
        );
      }
    } catch {
      // Ignore errors on cleanup
    }

    try {
      this.socket?.close();
    } catch {
      // Ignore errors on cleanup
    }

    this.socket = null;
    this.active = false;
    this.onLog('UDP multicast stopped.');
  }

  /** Update multicast group and port (requires restart). */
  updateConfig(group: string, port: number): void {
    const wasActive = this.active;
    if (wasActive) {
      this.stop();
    }
    this.multicastGroup = group;
    this.port = port;
    if (wasActive) {
      this.start().catch(err => {
        this.onLog(`Multicast restart error: ${(err as Error).message}`, 'error');
      });
    }
  }
}
