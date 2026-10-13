/* FairSeat HTTP – Schnittstelle wie die bisher genutzte (sendRequest), damit die App gleich bleibt:
   sendRequest(url, { method, headers, data, connectTimeout, readTimeout }, ok, fail)
   ok(r)   bei Status 200–299:          r = { status, headers (Namen klein), data (Text) }
   fail(r) bei jedem anderen Status:     r = { status, headers, data, error }
           bei Netzfehlern status ≤ 0:   -1 kein Netz, -2 Zertifikat, -3 ungültige Adresse, -4 Zeitüberschreitung */
var exec = require('cordova/exec');
module.exports = {
  sendRequest: function(url, opts, ok, fail){
    opts = opts || {};
    var args = [String(opts.method || 'get').toUpperCase(), String(url), opts.headers || {},
                typeof opts.data === 'string' ? opts.data : null,
                Number(opts.connectTimeout) || 15, Number(opts.readTimeout) || 60];
    exec(function(r){
      r = r || {};
      var res = { status: Number(r.status) || 0, headers: r.headers || {}, data: typeof r.data === 'string' ? r.data : '' };
      if(res.status >= 200 && res.status < 300) ok(res);
      else { res.error = res.data; fail(res); }
    }, function(e){
      e = e || {};
      fail({ status: typeof e.status === 'number' ? e.status : -1, headers: {}, data: '', error: String(e.error || '') });
    }, 'FairSeatHttp', 'request', args);
  }
};
