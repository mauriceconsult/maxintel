// Server-rendered mobile-money top-up checkout. No build step, no framework — a single
// self-contained HTML document, because the people who hit this page are
// typically on a phone, on mobile data, one tap away from abandoning.

export type CheckoutBundle = {
  id: string;
  credits: number;
  ugx: number;
  kes: number;
  discountPct: number;
};

export type CheckoutPageData = {
  token: string;
  clientName: string;
  balance: number;
  /** Credits the blocked request needed, when the page was reached from a 402 */
  required: number | null;
  /** Model that triggered the 402, for context */
  model: string | null;
  returnUrl: string | null;
  bundles: CheckoutBundle[];
  ugxPerCredit: number;
  phonePlaceholder: string;
  darajaPhonePlaceholder: string;
  darajaEnabled: boolean;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// JSON embedded in a <script> must not be able to close the tag it lives in.
function escapeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

const STYLES = `
*{box-sizing:border-box;margin:0;padding:0}
body{
  font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  background:#0b0b0f;color:#e8e8ea;min-height:100vh;padding:24px 16px 48px;
  -webkit-font-smoothing:antialiased;
}
.wrap{max-width:520px;margin:0 auto}
.brand{display:flex;align-items:center;gap:10px;margin-bottom:24px}
.dot{width:10px;height:10px;border-radius:50%;background:#ffcc00}
.brand span{font-weight:600;letter-spacing:-.01em}
h1{font-size:22px;font-weight:650;letter-spacing:-.02em;margin-bottom:6px}
.sub{color:#9a9aa3;font-size:14px;line-height:1.5}
.card{
  background:#141419;border:1px solid #24242c;border-radius:14px;
  padding:16px;margin-top:16px;
}
.balance{display:flex;justify-content:space-between;align-items:baseline}
.balance .n{font-size:26px;font-weight:650;letter-spacing:-.02em}
.balance .l{color:#9a9aa3;font-size:13px}
.warn{
  margin-top:12px;padding:10px 12px;border-radius:10px;font-size:13px;
  background:rgba(255,204,0,.08);border:1px solid rgba(255,204,0,.25);color:#ffd94d;
}
.label{
  font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;
  color:#8a8a93;margin:26px 0 10px;
}
.bundles{display:grid;gap:10px}
.providers{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.providers.single{grid-template-columns:1fr}
.provider{
  padding:12px;border:1px solid #24242c;border-radius:12px;background:#141419;
  color:inherit;font:inherit;font-weight:600;cursor:pointer;
}
.provider[aria-checked="true"]{border-color:#ffcc00;background:rgba(255,204,0,.06)}
.bundle{
  display:flex;justify-content:space-between;align-items:center;gap:12px;
  background:#141419;border:1px solid #24242c;border-radius:12px;
  padding:14px 16px;cursor:pointer;text-align:left;width:100%;color:inherit;
  font:inherit;transition:border-color .12s,background .12s;
}
.bundle:hover{border-color:#3a3a45}
.bundle[aria-checked="true"]{border-color:#ffcc00;background:rgba(255,204,0,.06)}
.bundle .c{font-size:16px;font-weight:600}
.bundle .m{color:#9a9aa3;font-size:12.5px;margin-top:3px}
.bundle .p{font-size:15px;font-weight:600;white-space:nowrap}
.tag{
  display:inline-block;margin-left:8px;padding:2px 7px;border-radius:999px;
  font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;
  background:#ffcc00;color:#1a1a00;vertical-align:middle;
}
.tag.save{background:rgba(80,220,140,.15);color:#5fe0a0}
input{
  width:100%;background:#141419;border:1px solid #24242c;border-radius:12px;
  padding:14px 16px;color:#e8e8ea;font-size:16px;font-family:inherit;
}
input:focus{outline:none;border-color:#ffcc00}
input::placeholder{color:#5c5c66}
.hint{color:#8a8a93;font-size:12.5px;margin-top:8px}
button.primary{
  width:100%;margin-top:20px;padding:15px;border:none;border-radius:12px;
  background:#ffcc00;color:#1a1a00;font-size:15.5px;font-weight:700;
  font-family:inherit;cursor:pointer;transition:opacity .12s;
}
button.primary:hover{opacity:.9}
button.primary:disabled{opacity:.45;cursor:not-allowed}
.ghost{
  display:block;width:100%;margin-top:10px;padding:12px;background:none;
  border:1px solid #24242c;border-radius:12px;color:#9a9aa3;font-size:14px;
  font-family:inherit;cursor:pointer;
}
.err{color:#ff7a7a;font-size:13.5px;margin-top:12px;min-height:18px}
.center{text-align:center;padding:12px 0}
.spinner{
  width:34px;height:34px;margin:8px auto 20px;border-radius:50%;
  border:3px solid #2a2a33;border-top-color:#ffcc00;animation:spin .8s linear infinite;
}
@keyframes spin{to{transform:rotate(360deg)}}
.tick{
  width:52px;height:52px;margin:4px auto 18px;border-radius:50%;
  background:rgba(80,220,140,.14);color:#5fe0a0;font-size:26px;line-height:52px;
}
.cross{
  width:52px;height:52px;margin:4px auto 18px;border-radius:50%;
  background:rgba(255,122,122,.14);color:#ff7a7a;font-size:26px;line-height:52px;
}
.steps{margin-top:18px;text-align:left;color:#9a9aa3;font-size:13.5px;line-height:1.9}
.steps li{margin-left:18px}
.ref{
  margin-top:16px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
  font-size:11.5px;color:#5c5c66;word-break:break-all;
}
.hidden{display:none}
.foot{margin-top:28px;text-align:center;color:#5c5c66;font-size:12px;line-height:1.7}
`;

export function renderCheckoutPage(data: CheckoutPageData): string {
  const shortfall =
    data.required !== null ? Math.max(0, data.required - data.balance) : null;

  // Pre-select the cheapest bundle that clears the shortfall, so the common
  // case is one tap: enter number, pay.
  const recommended =
    shortfall && shortfall > 0
      ? (data.bundles.find((b) => b.credits >= shortfall)?.id ??
        data.bundles[data.bundles.length - 1]?.id ??
        null)
      : (data.bundles[0]?.id ?? null);

  const bundleCards = data.bundles
    .map((b) => {
      const isRec = b.id === recommended;
      const save =
        b.discountPct > 0
          ? `<span class="tag save">Save ${b.discountPct}%</span>`
          : "";
      const rec = isRec ? `<span class="tag">Recommended</span>` : "";
      return `
      <button type="button" class="bundle" role="radio"
              aria-checked="${isRec ? "true" : "false"}"
              data-bundle="${escapeHtml(b.id)}" data-credits="${b.credits}">
        <span>
          <span class="c">${b.credits.toLocaleString()} credits${rec}</span>
          <span class="m">${escapeHtml(b.id)}${save}</span>
        </span>
        <span class="p" data-ugx="${b.ugx}" data-kes="${b.kes}">UGX ${b.ugx.toLocaleString()}</span>
      </button>`;
    })
    .join("");

  const shortfallNote =
    shortfall && shortfall > 0
      ? `<div class="warn">You need <strong>${shortfall.toLocaleString()}</strong> more credits${
          data.model ? ` to run ${escapeHtml(data.model)}` : ""
        }.</div>`
      : "";

  const darajaOption = data.darajaEnabled
    ? `<button type="button" class="provider" role="radio" aria-checked="false" data-provider="daraja">Safaricom M-PESA</button>`
    : "";

  const config = {
    token: data.token,
    returnUrl: data.returnUrl,
    recommended,
    placeholders: {
      momo: data.phonePlaceholder,
      daraja: data.darajaPhonePlaceholder,
    },
  };

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<meta name="theme-color" content="#0b0b0f">
<title>Top up credits — Maxintel</title>
<style>${STYLES}</style>
</head>
<body>
<div class="wrap">
  <div class="brand"><span class="dot"></span><span>Maxintel</span></div>

  <!-- ── Step 1: choose bundle ─────────────────────────────────────────── -->
  <section id="step-choose">
    <h1>Top up credits</h1>
    <p class="sub">Credits are added to your balance as soon as your payment is confirmed.</p>

    <div class="card">
      <div class="balance">
        <span class="n" id="balance">${data.balance.toLocaleString()}</span>
        <span class="l">credits · ${escapeHtml(data.clientName)}</span>
      </div>
      ${shortfallNote}
    </div>

    <div class="label">Choose a bundle</div>
    <div class="bundles" role="radiogroup" aria-label="Credit bundles">${bundleCards}</div>

    <div class="label">Choose payment method</div>
    <div class="providers${data.darajaEnabled ? "" : " single"}" role="radiogroup" aria-label="Payment method">
      <button type="button" class="provider" role="radio" aria-checked="true" data-provider="momo">MTN MoMo</button>
      ${darajaOption}
    </div>

    <div class="label" id="phone-label">MTN MoMo number</div>
    <input id="phone" type="tel" inputmode="numeric" autocomplete="tel"
           placeholder="${escapeHtml(data.phonePlaceholder)}" aria-label="MTN MoMo number">
    <p class="hint" id="phone-hint">You will get an approval prompt on this handset. 1 credit = UGX ${data.ugxPerCredit}.</p>

    <button class="primary" id="pay">Pay with MTN MoMo</button>
    <p class="err" id="error"></p>
  </section>

  <!-- ── Step 2: waiting for approval ──────────────────────────────────── -->
  <section id="step-waiting" class="hidden">
    <div class="center">
      <div class="spinner"></div>
      <h1>Check your phone</h1>
      <p class="sub">Approve the <span id="wait-provider">MTN MoMo</span> prompt on <strong id="wait-phone"></strong> to complete the payment.</p>
      <ol class="steps">
        <li>Open the prompt on your handset</li>
        <li>Enter your MoMo PIN</li>
        <li>Keep this page open — it updates automatically</li>
      </ol>
      <p class="ref" id="wait-ref"></p>
    </div>
  </section>

  <!-- ── Step 3: done ──────────────────────────────────────────────────── -->
  <section id="step-done" class="hidden">
    <div class="center">
      <div class="tick">&check;</div>
      <h1>Payment confirmed</h1>
      <p class="sub" id="done-detail"></p>
      <button class="ghost" id="done-return">Continue</button>
    </div>
  </section>

  <!-- ── Step 4: failed ────────────────────────────────────────────────── -->
  <section id="step-failed" class="hidden">
    <div class="center">
      <div class="cross">&times;</div>
      <h1 id="fail-title">Payment not completed</h1>
      <p class="sub" id="fail-detail"></p>
      <button class="primary" id="fail-retry">Try again</button>
    </div>
  </section>

  <p class="foot">Payments are processed securely by your selected provider.<br>No credits are added until payment is confirmed.</p>
</div>

<script>
(function () {
  var CONFIG = ${escapeJson(config)};
  var POLL_MS = 3000;
  var TIMEOUT_MS = 180000;

  var selected = CONFIG.recommended;
  var provider = 'momo';
  var pollTimer = null;
  var deadline = 0;

  function $(id) { return document.getElementById(id); }
  function show(id) {
    ['step-choose', 'step-waiting', 'step-done', 'step-failed'].forEach(function (s) {
      $(s).classList.toggle('hidden', s !== id);
    });
    window.scrollTo(0, 0);
  }

  // ── Bundle selection ──────────────────────────────────────────────────
  var cards = document.querySelectorAll('.bundle');
  Array.prototype.forEach.call(cards, function (card) {
    card.addEventListener('click', function () {
      selected = card.getAttribute('data-bundle');
      Array.prototype.forEach.call(cards, function (c) {
        c.setAttribute('aria-checked', String(c === card));
      });
      $('error').textContent = '';
    });
  });

  var providers = document.querySelectorAll('.provider');
  Array.prototype.forEach.call(providers, function (button) {
    button.addEventListener('click', function () {
      provider = button.getAttribute('data-provider');
      Array.prototype.forEach.call(providers, function (item) {
        item.setAttribute('aria-checked', String(item === button));
      });
      var isDaraja = provider === 'daraja';
      $('phone-label').textContent = isDaraja ? 'Safaricom M-PESA number' : 'MTN MoMo number';
      $('phone').placeholder = CONFIG.placeholders[provider];
      $('phone').setAttribute('aria-label', $('phone-label').textContent);
      $('phone-hint').textContent = isDaraja
        ? 'You will get an M-PESA STK prompt on this handset. Prices are converted to KES using the configured exchange rate.'
        : 'You will get an approval prompt on this handset. 1 credit = UGX ${data.ugxPerCredit}.';
      Array.prototype.forEach.call(document.querySelectorAll('.bundle .p'), function (price) {
        var amount = Number(price.getAttribute(isDaraja ? 'data-kes' : 'data-ugx'));
        price.textContent = (isDaraja ? 'KES ' : 'UGX ') + amount.toLocaleString();
      });
      $('pay').textContent = isDaraja ? 'Pay with Safaricom M-PESA' : 'Pay with MTN MoMo';
      $('error').textContent = '';
    });
  });

  // ── Submit ────────────────────────────────────────────────────────────
  $('pay').addEventListener('click', function () {
    var phone = $('phone').value.replace(/[^0-9+]/g, '');
    if (!selected) { $('error').textContent = 'Choose a bundle first.'; return; }
    if (phone.replace(/\\D/g, '').length < 9) {
      $('error').textContent = provider === 'daraja'
        ? 'Enter a valid Kenyan Safaricom number.'
        : 'Enter a valid MTN MoMo number.';
      $('phone').focus();
      return;
    }

    $('pay').disabled = true;
    $('pay').textContent = 'Sending request ...';
    $('error').textContent = '';

    fetch('/billing/topup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Checkout-Token': CONFIG.token },
      body: JSON.stringify({
        bundleId: selected,
        phone: phone,
        provider: provider,
        successUrl: CONFIG.returnUrl || undefined
      })
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          if (!res.ok) throw new Error(body.error || 'Request failed (' + res.status + ')');
          return body;
        });
      })
      .then(function (body) {
        $('wait-phone').textContent = phone;
        $('wait-provider').textContent = provider === 'daraja' ? 'Safaricom M-PESA' : 'MTN MoMo';
        $('wait-ref').textContent = 'Ref: ' + body.referenceId;
        show('step-waiting');
        deadline = Date.now() + TIMEOUT_MS;
        poll(body.referenceId);
      })
      .catch(function (err) {
        $('pay').disabled = false;
        $('pay').textContent = provider === 'daraja' ? 'Pay with Safaricom M-PESA' : 'Pay with MTN MoMo';
        $('error').textContent = err.message || 'Could not start the payment.';
      });
  });

  // ── Poll for confirmation ─────────────────────────────────────────────
  function poll(ref) {
    fetch('/billing/status/' + encodeURIComponent(ref), {
      headers: { 'X-Checkout-Token': CONFIG.token }
    })
      .then(function (res) { return res.json(); })
      .then(function (body) {
        if (body.status === 'SUCCESSFUL') return succeed(body);
        if (body.status && body.status !== 'PENDING') {
          return fail('Payment not completed', body.status + '. Nothing was charged.');
        }
        if (Date.now() > deadline) {
          return fail(
            'Still waiting for confirmation',
            'We have not had a confirmation yet. If you approved the prompt, your credits ' +
            'will land shortly — reload this page to check.'
          );
        }
        pollTimer = setTimeout(function () { poll(ref); }, POLL_MS);
      })
      .catch(function () {
        if (Date.now() > deadline) {
          return fail('Connection lost', 'We could not reach the server. Reload to check your balance.');
        }
        pollTimer = setTimeout(function () { poll(ref); }, POLL_MS);
      });
  }

  function succeed(body) {
    if (pollTimer) clearTimeout(pollTimer);
    $('done-detail').textContent =
      Number(body.credits).toLocaleString() + ' credits added. ' +
      'New balance: ' + Number(body.balanceAfter).toLocaleString() + ' credits.';

    var target = body.redirectUrl || CONFIG.returnUrl;
    if (target) {
      $('done-return').textContent = 'Continue';
      $('done-return').onclick = function () { window.location.href = target; };
      setTimeout(function () { window.location.href = target; }, 2500);
    } else {
      $('done-return').textContent = 'Close this tab';
      $('done-return').onclick = function () { window.close(); };
    }
    show('step-done');
  }

  function fail(title, detail) {
    if (pollTimer) clearTimeout(pollTimer);
    $('fail-title').textContent = title;
    $('fail-detail').textContent = detail;
    show('step-failed');
  }

  $('fail-retry').addEventListener('click', function () {
    $('pay').disabled = false;
    $('pay').textContent = provider === 'daraja' ? 'Pay with Safaricom M-PESA' : 'Pay with MTN MoMo';
    show('step-choose');
  });
})();
</script>
</body>
</html>`;
}

// ── Expired / invalid link ────────────────────────────────────────────────────
export function renderExpiredPage(reason: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Link expired — Maxintel</title>
<style>${STYLES}</style>
</head>
<body>
<div class="wrap">
  <div class="brand"><span class="dot"></span><span>Maxintel</span></div>
  <div class="center">
    <div class="cross">&times;</div>
    <h1>This top-up link has expired</h1>
    <p class="sub">${escapeHtml(reason)}</p>
    <ol class="steps">
      <li>Go back to Maxintel</li>
      <li>Run <strong>/upgrade</strong> (or retry the request)</li>
      <li>Open the fresh link it gives you</li>
    </ol>
  </div>
  <p class="foot">Checkout links are valid for 30 minutes for your security.</p>
</div>
</body>
</html>`;
}
