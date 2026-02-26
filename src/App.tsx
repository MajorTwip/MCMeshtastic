/**
 * App.tsx
 *
 * Root component.  Provides global state, initialises services, and renders a
 * three-tab navigator: BLE Scanner | Settings | Bridge Status.
 */

import React, {useState, useMemo, useEffect, useRef} from 'react';
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
} from 'react-native';

import {AppStateProvider, useAppState, makeLog} from './store/AppState';
import {BluetoothService} from './services/BluetoothService';
import {BridgeService} from './services/BridgeService';

import BluetoothScanner from './components/BluetoothScanner';
import MulticastSettings from './components/MulticastSettings';
import BridgeStatus from './components/BridgeStatus';

// ── Tab definitions ────────────────────────────────────────────────────────────

type Tab = 'bluetooth' | 'settings' | 'bridge';

const TABS: {key: Tab; label: string; icon: string}[] = [
  {key: 'bluetooth', label: 'Bluetooth', icon: '📶'},
  {key: 'settings', label: 'Settings', icon: '⚙️'},
  {key: 'bridge', label: 'Bridge', icon: '🔁'},
];

// ── Inner app (needs context) ──────────────────────────────────────────────────

function AppInner() {
  const [activeTab, setActiveTab] = useState<Tab>('bluetooth');
  const {dispatch} = useAppState();

  // Services are created once and held in refs so they survive re-renders
  const bleServiceRef = useRef<BluetoothService | null>(null);
  const bridgeServiceRef = useRef<BridgeService | null>(null);

  if (!bleServiceRef.current) {
    bleServiceRef.current = new BluetoothService((msg, level) => {
      dispatch({type: 'ADD_LOG', entry: makeLog(msg, level ?? 'info')});
    });
  }

  if (!bridgeServiceRef.current) {
    bridgeServiceRef.current = new BridgeService(
      bleServiceRef.current,
      (msg, level) => {
        dispatch({type: 'ADD_LOG', entry: makeLog(msg, level ?? 'info')});
      },
      direction => {
        if (direction === 'ble') {
          dispatch({type: 'INCREMENT_BLE_PACKETS'});
        } else {
          dispatch({type: 'INCREMENT_UDP_PACKETS'});
        }
      },
    );
  }

  // Destroy BLE manager on unmount
  useEffect(() => {
    const ble = bleServiceRef.current;
    return () => {
      ble?.destroy();
    };
  }, []);

  const bleService = bleServiceRef.current;
  const bridgeService = bridgeServiceRef.current;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>MCMeshtastic</Text>
        <Text style={styles.headerSub}>Meshtastic ↔ UDP Multicast Bridge</Text>
      </View>

      {/* Content */}
      <View style={styles.content}>
        {activeTab === 'bluetooth' && (
          <BluetoothScanner bleService={bleService} />
        )}
        {activeTab === 'settings' && (
          <MulticastSettings />
        )}
        {activeTab === 'bridge' && (
          <BridgeStatus
            bridgeService={bridgeService}
            bleService={bleService}
          />
        )}
      </View>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        {TABS.map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tabItem, activeTab === tab.key && styles.tabItemActive]}
            onPress={() => setActiveTab(tab.key)}>
            <Text style={styles.tabIcon}>{tab.icon}</Text>
            <Text
              style={[
                styles.tabLabel,
                activeTab === tab.key && styles.tabLabelActive,
              ]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
  );
}

// ── Root export ────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <AppStateProvider>
      <AppInner />
    </AppStateProvider>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {flex: 1, backgroundColor: '#fff'},

  header: {
    backgroundColor: '#007bff',
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  headerSub: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    marginTop: 2,
  },

  content: {flex: 1},

  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    paddingBottom: 4,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
  },
  tabItemActive: {
    borderTopWidth: 2,
    borderTopColor: '#007bff',
  },
  tabIcon: {fontSize: 20},
  tabLabel: {fontSize: 11, color: '#888', marginTop: 2},
  tabLabelActive: {color: '#007bff', fontWeight: '600'},
});
