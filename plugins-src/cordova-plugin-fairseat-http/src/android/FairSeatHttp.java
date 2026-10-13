package de.fairseat.http;

import org.apache.cordova.CallbackContext;
import org.apache.cordova.CordovaPlugin;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import javax.net.ssl.SSLException;

/** HTTPS-Anfragen für den WebDAV-Abgleich von FairSeat.
 *  Keine Cookies, kein Zwischenspeicher, Weiterleitungen werden nicht verfolgt. */
public class FairSeatHttp extends CordovaPlugin {

    @Override
    public boolean execute(String action, JSONArray args, final CallbackContext cb) throws JSONException {
        if (!"request".equals(action)) return false;
        final String method = args.optString(0, "GET").toUpperCase(Locale.ROOT);
        final String url = args.optString(1, "");
        final JSONObject headers = args.optJSONObject(2);
        final String body = args.isNull(3) ? null : args.optString(3, null);
        final int connectTimeout = args.optInt(4, 15);
        final int readTimeout = args.optInt(5, 60);
        cordova.getThreadPool().execute(new Runnable() {
            @Override public void run() { request(method, url, headers, body, connectTimeout, readTimeout, cb); }
        });
        return true;
    }

    private void request(String method, String url, JSONObject headers, String body, int connectTimeout, int readTimeout, CallbackContext cb) {
        HttpURLConnection c = null;
        try {
            URL u = new URL(url);
            if (!"https".equalsIgnoreCase(u.getProtocol())) { fail(cb, -3, "invalid url"); return; }
            c = (HttpURLConnection) u.openConnection();
            c.setInstanceFollowRedirects(false);
            c.setUseCaches(false);
            c.setConnectTimeout(Math.max(1, connectTimeout) * 1000);
            c.setReadTimeout(Math.max(1, readTimeout) * 1000);
            c.setRequestMethod(method);
            if (headers != null) {
                Iterator<String> it = headers.keys();
                while (it.hasNext()) {
                    String k = it.next();
                    c.setRequestProperty(k, headers.optString(k, ""));
                }
            }
            if (body != null) {
                byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                c.setDoOutput(true);
                c.setFixedLengthStreamingMode(bytes.length);
                OutputStream os = c.getOutputStream();
                try { os.write(bytes); } finally { os.close(); }
            }
            int status = c.getResponseCode();
            JSONObject hs = new JSONObject();
            for (Map.Entry<String, List<String>> e : c.getHeaderFields().entrySet()) {
                if (e.getKey() == null || e.getValue() == null) continue;
                hs.put(e.getKey().toLowerCase(Locale.ROOT), join(e.getValue()));
            }
            InputStream in;
            try { in = c.getInputStream(); } catch (IOException ex) { in = c.getErrorStream(); }
            String text = in == null ? "" : read(in);
            JSONObject out = new JSONObject();
            out.put("status", status);
            out.put("headers", hs);
            out.put("data", text);
            cb.success(out);
        } catch (SocketTimeoutException e) {
            fail(cb, -4, e.getMessage());
        } catch (SSLException e) {
            fail(cb, -2, e.getMessage());
        } catch (Exception e) {
            fail(cb, -1, e.getMessage());
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private static String join(List<String> values) {
        StringBuilder sb = new StringBuilder();
        for (String v : values) { if (v == null) continue; if (sb.length() > 0) sb.append(", "); sb.append(v); }
        return sb.toString();
    }

    private static String read(InputStream in) throws IOException {
        try {
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] chunk = new byte[16384];
            int n;
            while ((n = in.read(chunk)) != -1) buf.write(chunk, 0, n);
            return new String(buf.toByteArray(), StandardCharsets.UTF_8);
        } finally {
            in.close();
        }
    }

    private static void fail(CallbackContext cb, int status, String msg) {
        try {
            JSONObject o = new JSONObject();
            o.put("status", status);
            o.put("error", msg == null ? "" : msg);
            cb.error(o);
        } catch (JSONException e) {
            cb.error(status);
        }
    }
}
