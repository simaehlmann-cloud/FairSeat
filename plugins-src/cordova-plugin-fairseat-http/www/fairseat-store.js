/* FairSeat Store – ein einziger In-App-Kauf (Vollversion), StoreKit 2.
   status(id, ok, fail)   ok({ owned: true|false })            – gilt der Kauf auf diesem Gerät/dieser Apple-ID?
   product(id, ok, fail)  ok({ id, price })                    – Preis als fertiger Text, z. B. "3,99 €"
   buy(id, ok, fail)      ok({ result: "purchased"|"pending"|"cancelled" })
   restore(id, ok, fail)  ok({ owned, error, cancelled })      – Abgleich mit dem App Store (Apple-ID-Anmeldung möglich)
   watch(cb)              cb({ productId }) bei jeder Änderung (z. B. "Kaufen anfragen" genehmigt, Erstattung)
   fail(e)                e = { error: Text }                                                                      */
var exec = require('cordova/exec');
function call(action, args, ok, fail){
  exec(function(r){ if(typeof ok === 'function') ok(r || {}); },
       function(e){ if(typeof fail === 'function') fail({ error: String((e && e.error) || e || '') }); },
       'FairSeatStore', action, args);
}
module.exports = {
  status:  function(id, ok, fail){ call('status',  [String(id)], ok, fail); },
  product: function(id, ok, fail){ call('product', [String(id)], ok, fail); },
  buy:     function(id, ok, fail){ call('buy',     [String(id)], ok, fail); },
  restore: function(id, ok, fail){ call('restore', [String(id)], ok, fail); },
  watch:   function(cb){ call('watch', [], cb, null); }
};
