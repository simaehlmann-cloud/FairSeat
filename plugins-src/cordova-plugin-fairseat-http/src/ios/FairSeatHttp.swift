import Foundation

/// HTTPS-Anfragen für den WebDAV-Abgleich von FairSeat.
/// Keine Cookies, kein Zwischenspeicher, Weiterleitungen werden nicht verfolgt (3xx kommt als Antwort zurück).
@objc(FairSeatHttp) class FairSeatHttp: CDVPlugin, URLSessionTaskDelegate {

    private lazy var session: URLSession = {
        let cfg = URLSessionConfiguration.ephemeral
        cfg.httpCookieStorage = nil
        cfg.httpShouldSetCookies = false
        cfg.httpCookieAcceptPolicy = .never
        cfg.urlCache = nil
        cfg.requestCachePolicy = .reloadIgnoringLocalCacheData
        cfg.timeoutIntervalForResource = 180
        return URLSession(configuration: cfg, delegate: self, delegateQueue: nil)
    }()

    // Weiterleitungen nicht folgen – die App wertet 3xx selbst aus
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }

    @objc(request:)
    func request(_ command: CDVInvokedUrlCommand) {
        let method = ((command.argument(at: 0) as? String) ?? "GET").uppercased()
        guard let urlText = command.argument(at: 1) as? String,
              let url = URL(string: urlText),
              url.scheme?.lowercased() == "https" else {
            send(command, ok: false, ["status": -3, "error": "invalid url"])
            return
        }
        let headers = (command.argument(at: 2) as? [String: Any]) ?? [:]
        let body = command.argument(at: 3) as? String
        let readTimeout = (command.argument(at: 5) as? NSNumber)?.doubleValue ?? 60

        var req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: max(10, readTimeout))
        req.httpMethod = method
        req.httpShouldHandleCookies = false
        for (name, value) in headers {
            req.setValue(String(describing: value), forHTTPHeaderField: name)
        }
        if let text = body {
            req.httpBody = text.data(using: .utf8)
        }

        let task = session.dataTask(with: req) { [weak self] data, response, error in
            guard let self = self else { return }
            if let err = error as NSError? {
                var code = -1
                if err.code == NSURLErrorTimedOut {
                    code = -4
                } else if err.code == NSURLErrorServerCertificateUntrusted || err.code == NSURLErrorServerCertificateHasBadDate
                            || err.code == NSURLErrorServerCertificateHasUnknownRoot || err.code == NSURLErrorServerCertificateNotYetValid
                            || err.code == NSURLErrorSecureConnectionFailed {
                    code = -2
                }
                self.send(command, ok: false, ["status": code, "error": err.localizedDescription])
                return
            }
            guard let http = response as? HTTPURLResponse else {
                self.send(command, ok: false, ["status": -1, "error": "no response"])
                return
            }
            var out: [String: String] = [:]
            for (key, value) in http.allHeaderFields {
                out[String(describing: key).lowercased()] = String(describing: value)
            }
            var text = ""
            if let d = data {
                text = String(data: d, encoding: .utf8) ?? ""
            }
            self.send(command, ok: true, ["status": http.statusCode, "headers": out, "data": text])
        }
        task.resume()
    }

    private func send(_ command: CDVInvokedUrlCommand, ok: Bool, _ payload: [AnyHashable: Any]) {
        let result = CDVPluginResult(status: ok ? CDVCommandStatus_OK : CDVCommandStatus_ERROR, messageAs: payload)
        self.commandDelegate.send(result, callbackId: command.callbackId)
    }
}
