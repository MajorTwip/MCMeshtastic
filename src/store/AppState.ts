/**
 * AppState.ts
 * Simple React context + reducer for global app state.
 */

import React, {createContext, useContext, useReducer, ReactNode} from 'react';

// ── Types ──────────────────────────────────────────────────────────────────────

export type ConnectionStatus = 'disconnected' | 'scanning' | 'connecting' | 'connected' | 'error';

export interface LogEntry {
  id: number;
  timestamp: string;
  message: string;
  level: 'info' | 'warn' | 'error';
}

export interface AppStateType {
  // BLE
  bleStatus: ConnectionStatus;
  connectedDeviceId: string | null;
  connectedDeviceName: string | null;

  // Multicast
  multicastGroup: string;
  multicastPort: number;
  multicastActive: boolean;

  // Bridge
  bridgeActive: boolean;
  packetsFromBle: number;
  packetsFromUdp: number;

  // Log
  log: LogEntry[];
  /** Monotonically increasing counter used to assign unique log entry IDs. */
  _nextLogId: number;
}

// ── Initial state ──────────────────────────────────────────────────────────────

const initialState: AppStateType = {
  bleStatus: 'disconnected',
  connectedDeviceId: null,
  connectedDeviceName: null,
  multicastGroup: '224.0.0.251',
  multicastPort: 5353,
  multicastActive: false,
  bridgeActive: false,
  packetsFromBle: 0,
  packetsFromUdp: 0,
  log: [],
  _nextLogId: 1,
};

// ── Actions ────────────────────────────────────────────────────────────────────

type Action =
  | {type: 'SET_BLE_STATUS'; status: ConnectionStatus}
  | {type: 'SET_CONNECTED_DEVICE'; id: string | null; name: string | null}
  | {type: 'SET_MULTICAST_GROUP'; group: string}
  | {type: 'SET_MULTICAST_PORT'; port: number}
  | {type: 'SET_MULTICAST_ACTIVE'; active: boolean}
  | {type: 'SET_BRIDGE_ACTIVE'; active: boolean}
  | {type: 'INCREMENT_BLE_PACKETS'}
  | {type: 'INCREMENT_UDP_PACKETS'}
  | {type: 'ADD_LOG'; entry: Omit<LogEntry, 'id'>}
  | {type: 'CLEAR_LOG'};

function reducer(state: AppStateType, action: Action): AppStateType {
  switch (action.type) {
    case 'SET_BLE_STATUS':
      return {...state, bleStatus: action.status};

    case 'SET_CONNECTED_DEVICE':
      return {
        ...state,
        connectedDeviceId: action.id,
        connectedDeviceName: action.name,
      };

    case 'SET_MULTICAST_GROUP':
      return {...state, multicastGroup: action.group};

    case 'SET_MULTICAST_PORT':
      return {...state, multicastPort: action.port};

    case 'SET_MULTICAST_ACTIVE':
      return {...state, multicastActive: action.active};

    case 'SET_BRIDGE_ACTIVE':
      return {...state, bridgeActive: action.active};

    case 'INCREMENT_BLE_PACKETS':
      return {...state, packetsFromBle: state.packetsFromBle + 1};

    case 'INCREMENT_UDP_PACKETS':
      return {...state, packetsFromUdp: state.packetsFromUdp + 1};

    case 'ADD_LOG':
      return {
        ...state,
        _nextLogId: state._nextLogId + 1,
        // Keep last 200 log entries to avoid unbounded memory growth
        log: [
          ...state.log.slice(-199),
          {...action.entry, id: state._nextLogId},
        ],
      };

    case 'CLEAR_LOG':
      return {...state, log: []};

    default:
      return state;
  }
}

// ── Context ────────────────────────────────────────────────────────────────────

interface AppContextType {
  state: AppStateType;
  dispatch: React.Dispatch<Action>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppStateProvider({children}: {children: ReactNode}) {
  const [state, dispatch] = useReducer(reducer, initialState);
  return (
    <AppContext.Provider value={{state, dispatch}}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppState(): AppContextType {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('useAppState must be used within AppStateProvider');
  }
  return ctx;
}

// Helper to build a log entry
export function makeLog(
  message: string,
  level: LogEntry['level'] = 'info',
): Omit<LogEntry, 'id'> {
  return {
    timestamp: new Date().toISOString(),
    message,
    level,
  };
}
