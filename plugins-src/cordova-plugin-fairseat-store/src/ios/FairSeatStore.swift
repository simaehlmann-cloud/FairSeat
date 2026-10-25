import Foundation
import StoreKit

/// In-App-Kauf der FairSeat-Vollversion über StoreKit 2 (ab iOS 15).
/// Ein einziges Produkt (nicht verbrauchbar). Die App fragt nur „gekauft ja/nein“ ab;
/// geprüft wird die von Apple signierte Transaktion, nichts wird an eigene Server geschickt.
@objc(FairSeatStore) class FairSeatStore: CDVPlugin {

    private var updatesTask: Task<Void, Never>?
    private var watchId: String?

    // Beim Start (onload) lauschen: Käufe, die erst später bestätigt werden („Kaufen anfragen“
    // in der Familienfreigabe), Käufe von anderen Geräten und Erstattungen kommen hier an.
    override func pluginInitialize() {
        super.pluginInitialize()
        updatesTask = Task.detached { [weak self] in
            for await update in StoreKit.Transaction.updates {
                guard case .verified(let tx) = update else { continue }
                await tx.finish()
                self?.notify(tx.productID)
            }
        }
    }

    deinit {
        updatesTask?.cancel()
    }

    // ---- Befehle ----

    @objc(status:)
    func status(_ command: CDVInvokedUrlCommand) {
        guard let id = productId(command) else { return }
        Task {
            let owned = await self.owns(id)
            self.send(command, ok: true, ["owned": owned])
        }
    }

    @objc(product:)
    func product(_ command: CDVInvokedUrlCommand) {
        guard let id = productId(command) else { return }
        Task {
            do {
                guard let p = try await Product.products(for: [id]).first else {
                    self.send(command, ok: false, ["error": "product not found"])
                    return
                }
                self.send(command, ok: true, ["id": p.id, "price": p.displayPrice])
            } catch {
                self.send(command, ok: false, ["error": error.localizedDescription])
            }
        }
    }

    @objc(buy:)
    func buy(_ command: CDVInvokedUrlCommand) {
        guard let id = productId(command) else { return }
        Task {
            do {
                guard let p = try await Product.products(for: [id]).first else {
                    self.send(command, ok: false, ["error": "product not found"])
                    return
                }
                let result = try await p.purchase()
                switch result {
                case .success(let verification):
                    switch verification {
                    case .verified(let tx):
                        await tx.finish()
                        self.send(command, ok: true, ["result": "purchased"])
                    case .unverified(_, let err):
                        // Signatur stimmt nicht – nicht freischalten
                        self.send(command, ok: false, ["error": "unverified: " + err.localizedDescription])
                    }
                case .pending:
                    self.send(command, ok: true, ["result": "pending"])
                case .userCancelled:
                    self.send(command, ok: true, ["result": "cancelled"])
                @unknown default:
                    self.send(command, ok: true, ["result": "cancelled"])
                }
            } catch {
                self.send(command, ok: false, ["error": error.localizedDescription])
            }
        }
    }

    @objc(restore:)
    func restore(_ command: CDVInvokedUrlCommand) {
        guard let id = productId(command) else { return }
        Task {
            var problem = ""
            var cancelled = false
            do {
                try await AppStore.sync()          // fragt ggf. nach der Apple-ID
            } catch StoreKitError.userCancelled {
                cancelled = true                   // Anmeldung abgebrochen – der Stand zählt trotzdem
            } catch {
                problem = error.localizedDescription
            }
            let owned = await self.owns(id)
            self.send(command, ok: true, ["owned": owned, "error": problem, "cancelled": cancelled])
        }
    }

    @objc(watch:)
    func watch(_ command: CDVInvokedUrlCommand) {
        watchId = command.callbackId
        // cordova-ios 8: CDVPluginResult ist nie nil (NS_ASSUME_NONNULL) und send() verlangt ein
        // nicht-optionales Ergebnis – daher weder "?" noch optionale Typen.
        let r = CDVPluginResult(status: .noResult)
        r.setKeepCallbackAs(true)
        self.commandDelegate.send(r, callbackId: command.callbackId)
    }

    // ---- Helfer ----

    private func productId(_ command: CDVInvokedUrlCommand) -> String? {
        guard let id = command.argument(at: 0) as? String, !id.isEmpty, id.count <= 100 else {
            send(command, ok: false, ["error": "no product id"])
            return nil
        }
        return id
    }

    /// Gilt der Kauf? Nur von Apple bestätigte, nicht erstattete Transaktionen zählen.
    private func owns(_ id: String) async -> Bool {
        for await entitlement in StoreKit.Transaction.currentEntitlements {
            if case .verified(let tx) = entitlement, tx.productID == id, tx.revocationDate == nil {
                return true
            }
        }
        return false
    }

    private func notify(_ productId: String) {
        DispatchQueue.main.async {
            guard let cb = self.watchId else { return }
            let payload: [AnyHashable: Any] = ["productId": productId]
            let r = CDVPluginResult(status: .ok, messageAs: payload)
            r.setKeepCallbackAs(true)
            self.commandDelegate.send(r, callbackId: cb)
        }
    }

    private func send(_ command: CDVInvokedUrlCommand, ok: Bool, _ payload: [AnyHashable: Any]) {
        let result = CDVPluginResult(status: ok ? .ok : .error, messageAs: payload)
        DispatchQueue.main.async {
            self.commandDelegate.send(result, callbackId: command.callbackId)
        }
    }
}
