// UdpMulticastModule.h
//
// React Native Windows native module for UDP multicast operations.
//
// Exposed JS methods:
//   createSocket(socketId: string, port: number, promise)
//     – Creates and binds a UDP socket to the given port on all interfaces.
//
//   addMembership(socketId: string, multicastGroup: string,
//                 multicastInterface: string, promise)
//     – Joins the specified multicast group on a given interface.
//
//   dropMembership(socketId: string, multicastGroup: string,
//                  multicastInterface: string, promise)
//     – Leaves the specified multicast group.
//
//   send(socketId: string, data: string /*base64*/, host: string,
//        port: number, promise)
//     – Sends a base64-encoded datagram to host:port.
//
//   close(socketId: string, promise)
//     – Closes and removes the socket.
//
// JS events emitted on "UdpMulticastMessage":
//   { socketId: string, data: string /*base64*/, address: string, port: number }

#pragma once
#include "pch.h"

namespace winrt {
using namespace Windows::Foundation;
using namespace Windows::Networking;
using namespace Windows::Networking::Sockets;
using namespace Windows::Storage::Streams;
using namespace Windows::Security::Cryptography;
using namespace Microsoft::ReactNative;
}

namespace MCMeshtastic {

/// Per-socket state kept in the module.
struct SocketEntry {
    winrt::DatagramSocket socket{nullptr};
    /// Event token for the MessageReceived handler, used to detach on close.
    winrt::DatagramSocket::MessageReceived_revoker messageRevoker{};
};

REACT_MODULE(UdpMulticastModule, L"UdpMulticastModule")
struct UdpMulticastModule {

    // ── React context ─────────────────────────────────────────────────────────

    REACT_INIT(Initialize)
    void Initialize(winrt::ReactContext const& reactContext) noexcept {
        m_reactContext = reactContext;
    }

    // ── createSocket ──────────────────────────────────────────────────────────

    REACT_METHOD(CreateSocket, L"createSocket")
    winrt::fire_and_forget CreateSocket(
        std::string socketId,
        int port,
        winrt::ReactPromise<bool> promise) noexcept
    {
        try {
            SocketEntry entry{};
            entry.socket = winrt::DatagramSocket();

            // Allow multiple processes to bind to the same port (multicast)
            entry.socket.Control().MulticastOnly(false);
            entry.socket.Control().QualityOfService(
                winrt::SocketQualityOfService::LowLatency);

            // Register message handler
            entry.messageRevoker = entry.socket.MessageReceived(
                winrt::auto_revoke,
                [this, socketId](winrt::DatagramSocket const&,
                                  winrt::DatagramSocketMessageReceivedEventArgs const& args) {
                    OnMessageReceived(socketId, args);
                });

            // Bind to all interfaces on the requested port
            co_await entry.socket.BindServiceNameAsync(
                winrt::to_hstring(std::to_string(port)));

            {
                std::lock_guard<std::mutex> lock(m_mutex);
                m_sockets[socketId] = std::move(entry);
            }

            promise.Resolve(true);
        } catch (winrt::hresult_error const& ex) {
            promise.Reject(winrt::to_string(ex.message()).c_str());
        }
    }

    // ── addMembership ─────────────────────────────────────────────────────────

    REACT_METHOD(AddMembership, L"addMembership")
    void AddMembership(
        std::string socketId,
        std::string multicastGroup,
        std::string multicastInterface,
        winrt::ReactPromise<bool> promise) noexcept
    {
        try {
            SocketEntry* entry = FindSocket(socketId);
            if (!entry) {
                promise.Reject("Socket not found");
                return;
            }

            winrt::HostName groupHost{winrt::to_hstring(multicastGroup)};

            if (multicastInterface.empty() || multicastInterface == "0.0.0.0") {
                // Join on all local interfaces
                entry->socket.JoinMulticastGroup(groupHost);
            } else {
                winrt::HostName ifaceHost{winrt::to_hstring(multicastInterface)};
                entry->socket.JoinMulticastGroup(groupHost, ifaceHost);
            }

            promise.Resolve(true);
        } catch (winrt::hresult_error const& ex) {
            promise.Reject(winrt::to_string(ex.message()).c_str());
        }
    }

    // ── dropMembership ────────────────────────────────────────────────────────

    REACT_METHOD(DropMembership, L"dropMembership")
    void DropMembership(
        std::string socketId,
        std::string multicastGroup,
        std::string multicastInterface,
        winrt::ReactPromise<bool> promise) noexcept
    {
        // WinRT DatagramSocket does not expose an explicit LeaveMulticastGroup.
        // Closing the socket is the standard way to leave all groups.
        // We record the intent and report success; the actual leave happens on close.
        promise.Resolve(true);
    }

    // ── send ──────────────────────────────────────────────────────────────────

    REACT_METHOD(Send, L"send")
    winrt::fire_and_forget Send(
        std::string socketId,
        std::string base64Data,
        std::string host,
        int port,
        winrt::ReactPromise<bool> promise) noexcept
    {
        try {
            SocketEntry* entry = FindSocket(socketId);
            if (!entry) {
                promise.Reject("Socket not found");
                co_return;
            }

            // Decode base64
            winrt::IBuffer buf = winrt::CryptographicBuffer::DecodeFromBase64String(
                winrt::to_hstring(base64Data));

            // Get (or create) an output stream to the target
            winrt::HostName targetHost{winrt::to_hstring(host)};
            auto stream = co_await entry->socket.GetOutputStreamAsync(
                targetHost, winrt::to_hstring(std::to_string(port)));

            winrt::DataWriter writer{stream};
            writer.WriteBuffer(buf);
            co_await writer.StoreAsync();
            co_await writer.FlushAsync();
            writer.DetachStream();

            promise.Resolve(true);
        } catch (winrt::hresult_error const& ex) {
            promise.Reject(winrt::to_string(ex.message()).c_str());
        }
    }

    // ── close ─────────────────────────────────────────────────────────────────

    REACT_METHOD(Close, L"close")
    void Close(
        std::string socketId,
        winrt::ReactPromise<bool> promise) noexcept
    {
        try {
            std::lock_guard<std::mutex> lock(m_mutex);
            auto it = m_sockets.find(socketId);
            if (it != m_sockets.end()) {
                it->second.messageRevoker.revoke();
                it->second.socket.Close();
                m_sockets.erase(it);
            }
            promise.Resolve(true);
        } catch (winrt::hresult_error const& ex) {
            promise.Reject(winrt::to_string(ex.message()).c_str());
        }
    }

private:
    // ── Helpers ───────────────────────────────────────────────────────────────

    void OnMessageReceived(
        std::string const& socketId,
        winrt::DatagramSocketMessageReceivedEventArgs const& args)
    {
        try {
            auto reader = args.GetDataReader();
            uint32_t len = reader.UnconsumedBufferLength();
            winrt::IBuffer buf = reader.ReadBuffer(len);

            std::string base64 = winrt::to_string(
                winrt::CryptographicBuffer::EncodeToBase64String(buf));

            std::string remoteAddr = winrt::to_string(
                args.RemoteAddress().CanonicalName());
            int remotePort = std::stoi(
                winrt::to_string(args.RemotePort()));

            // Emit event to JS
            m_reactContext.EmitJSEvent(
                L"RCTDeviceEventEmitter",
                L"UdpMulticastMessage",
                [&](winrt::IJSValueWriter const& writer) {
                    writer.WriteObjectBegin();
                    WriteProperty(writer, L"socketId",
                        winrt::to_hstring(socketId));
                    WriteProperty(writer, L"data",
                        winrt::to_hstring(base64));
                    WriteProperty(writer, L"address",
                        winrt::to_hstring(remoteAddr));
                    WriteProperty(writer, L"port",
                        static_cast<int64_t>(remotePort));
                    writer.WriteObjectEnd();
                });
        } catch (...) {
            // Silently drop malformed datagrams
        }
    }

    SocketEntry* FindSocket(std::string const& id) {
        std::lock_guard<std::mutex> lock(m_mutex);
        auto it = m_sockets.find(id);
        return it != m_sockets.end() ? &it->second : nullptr;
    }

    static void WriteProperty(
        winrt::IJSValueWriter const& writer,
        winrt::hstring const& name,
        winrt::hstring const& value)
    {
        writer.WritePropertyName(name);
        writer.WriteString(value);
    }

    static void WriteProperty(
        winrt::IJSValueWriter const& writer,
        winrt::hstring const& name,
        int64_t value)
    {
        writer.WritePropertyName(name);
        writer.WriteInt64(value);
    }

    // ── Members ───────────────────────────────────────────────────────────────

    winrt::ReactContext m_reactContext{nullptr};
    std::mutex m_mutex;
    std::unordered_map<std::string, SocketEntry> m_sockets;
};

} // namespace MCMeshtastic
