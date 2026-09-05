/* LIVYA Metabolic password recovery.
 * Uses Supabase Auth recovery links. No password is ever exposed to an administrator.
 */
(function () {
  'use strict';

  const cfg = window.LIVYA_SUPABASE_CONFIG;
  if (!cfg || !window.supabase?.createClient) return;

  const RECOVERY_PARAM = 'recovery';
  const isRecoveryUrl = () => {
    try {
      const u = new URL(window.location.href);
      if (u.searchParams.get(RECOVERY_PARAM) === '1') return true;
      const hash = new URLSearchParams(String(u.hash || '').replace(/^#/, ''));
      return hash.get('type') === 'recovery';
    } catch (_) { return false; }
  };

  const client = window.supabase.createClient(cfg.url, cfg.publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'livya-metabolic-auth'
    }
  });

  let recoveryMode = false;
  let recoveryError = '';
  let recoverySuccess = false;

  const esc = value => String(value ?? '').replace(/[&<>\"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'
  }[c]));

  function css() {
    if (document.getElementById('livyaRecoveryCss')) return;
    const s = document.createElement('style');
    s.id = 'livyaRecoveryCss';
    s.textContent = `
      #livyaRecoveryOverlay{position:fixed;inset:0;z-index:99999;background:var(--paper,#f7f5ef);display:none;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}
      #livyaRecoveryCard{width:min(460px,100%);background:#fff;border:1px solid #dfe4df;border-radius:18px;padding:30px;box-shadow:0 24px 70px rgba(20,35,28,.14)}
      #livyaRecoveryCard h1{margin:0 0 7px;font:700 28px Georgia,serif;color:#162d24}
      #livyaRecoveryCard .lr-sub{margin:0 0 24px;font:12px var(--mono,monospace);line-height:1.6;color:#66736c}
      #livyaRecoveryCard label{display:block;margin:14px 0 6px;font:10px var(--mono,monospace);letter-spacing:.06em;text-transform:uppercase;color:#53615a}
      #livyaRecoveryCard input{width:100%;box-sizing:border-box;border:1px solid #d3dad5;border-radius:10px;padding:12px 13px;background:#fbfcfa;font-size:15px;outline:none}
      #livyaRecoveryCard input:focus{border-color:#73867c;box-shadow:0 0 0 3px rgba(84,108,96,.1)}
      #livyaRecoveryCard button{width:100%;margin-top:18px;border:0;border-radius:10px;padding:12px 14px;background:#162d24;color:#fff;font-weight:700;cursor:pointer}
      #livyaRecoveryCard button:disabled{opacity:.6;cursor:wait}
      .lr-msg{margin-top:14px;padding:10px 12px;border-radius:9px;font:11px var(--mono,monospace);line-height:1.5}
      .lr-error{color:#8b2f2f;background:#fff1f1;border:1px solid #efd2d2}
      .lr-ok{color:#285c43;background:#eef8f1;border:1px solid #cfe6d5}
      .lr-foot{margin-top:18px;font:10px var(--mono,monospace);color:#7a847e;text-align:center}
    `;
    document.head.appendChild(s);
  }

  function shell() {
    if (document.getElementById('livyaRecoveryOverlay')) return document.getElementById('livyaRecoveryOverlay');
    const o = document.createElement('div');
    o.id = 'livyaRecoveryOverlay';
    o.innerHTML = `<div id="livyaRecoveryCard" role="dialog" aria-modal="true" aria-labelledby="livyaRecoveryTitle"></div>`;
    document.body.appendChild(o);
    return o;
  }

  function render() {
    const o = shell();
    const card = o.querySelector('#livyaRecoveryCard');
    if (recoverySuccess) {
      card.innerHTML = `
        <h1>Password updated</h1>
        <p class="lr-sub">Your LIVYA Metabolic password has been changed successfully. You can now sign in with the new password.</p>
        <button type="button" id="lrContinue">Continue to sign in</button>
        <div class="lr-foot">For security, the recovery link can only be used for its intended recovery session.</div>`;
      o.style.display = 'flex';
      card.querySelector('#lrContinue').onclick = () => {
        window.location.href = window.location.origin + window.location.pathname;
      };
      return;
    }

    card.innerHTML = `
      <h1 id="livyaRecoveryTitle">Set a new password</h1>
      <p class="lr-sub">Choose a new password for your LIVYA Metabolic account. Your password is handled by Supabase Auth and is never visible to administrators.</p>
      <form id="livyaRecoveryForm" novalidate>
        <label for="lrPw">New password</label>
        <input id="lrPw" name="password" type="password" minlength="8" autocomplete="new-password" required>
        <label for="lrPw2">Confirm new password</label>
        <input id="lrPw2" name="confirm" type="password" minlength="8" autocomplete="new-password" required>
        ${recoveryError ? `<div class="lr-msg lr-error" role="alert">${esc(recoveryError)}</div>` : ''}
        <button id="lrSubmit" type="submit">Update password</button>
      </form>
      <div class="lr-foot">Use at least 8 characters. Never share your password with another person.</div>`;
    o.style.display = 'flex';
    const form = card.querySelector('#livyaRecoveryForm');
    form.onsubmit = async event => {
      event.preventDefault();
      recoveryError = '';
      const password = card.querySelector('#lrPw').value;
      const confirm = card.querySelector('#lrPw2').value;
      if (password.length < 8) { recoveryError = 'Password must be at least 8 characters.'; return render(); }
      if (password !== confirm) { recoveryError = 'The passwords do not match.'; return render(); }
      const button = card.querySelector('#lrSubmit');
      button.disabled = true;
      button.textContent = 'Updating…';
      try {
        const { error } = await client.auth.updateUser({ password });
        if (error) throw error;
        recoverySuccess = true;
        render();
      } catch (error) {
        console.error('[LIVYA] Password recovery update failed:', error);
        recoveryError = /expired|invalid|session/i.test(String(error?.message || ''))
          ? 'This password-reset link is invalid or has expired. Request a new reset email and use the newest link.'
          : String(error?.message || 'Unable to update the password. Please request a new reset email.');
        render();
      }
    };
  }

  async function startRecovery() {
    if (recoveryMode) return;
    recoveryMode = true;
    css();
    render();
    try {
      const { data: { session } = {} } = await client.auth.getSession();
      if (!session?.user) {
        recoveryError = 'The password-reset link did not create a valid recovery session. Request a new reset email and open the newest link in the same browser.';
        render();
      }
    } catch (error) {
      console.error('[LIVYA] Password recovery session error:', error);
      recoveryError = 'Unable to establish the password-reset session. Request a new reset email and try again.';
      render();
    }
  }

  async function requestReset(email, statusNode) {
    if (!email) {
      statusNode.textContent = 'Enter your work email address first.';
      statusNode.className = 'lr-msg lr-error';
      return;
    }
    statusNode.textContent = 'Sending reset email…';
    statusNode.className = 'lr-msg';
    try {
      const configuredRedirect = String(cfg.recoveryRedirectUrl || '').trim();
      const redirectTo = configuredRedirect || `${window.location.origin}${window.location.pathname}?${RECOVERY_PARAM}=1`;
      const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
      statusNode.textContent = 'If that account can use password recovery, a reset email has been sent. Open the newest email and follow the link.';
      statusNode.className = 'lr-msg lr-ok';
    } catch (error) {
      console.error('[LIVYA] Password reset request failed:', error);
      statusNode.textContent = String(error?.message || 'Unable to send the reset email. Please try again.');
      statusNode.className = 'lr-msg lr-error';
    }
  }

  function installForgotPassword() {
    const form = document.getElementById('loginForm');
    if (!form || form.querySelector('#livyaForgotPassword')) return;
    const emailInput = form.querySelector('#liEmail');
    if (!emailInput) return;
    const wrap = document.createElement('div');
    wrap.id = 'livyaForgotPassword';
    wrap.style.cssText = 'margin-top:10px;text-align:right;';
    wrap.innerHTML = `<button type="button" id="lrForgot" style="border:0;background:transparent;padding:4px 0;color:inherit;text-decoration:underline;cursor:pointer;font:10px var(--mono,monospace;">Forgot password?</button><div id="lrResetStatus" style="text-align:left"></div>`;
    form.appendChild(wrap);
    wrap.querySelector('#lrForgot').onclick = async () => {
      const email = emailInput.value.trim().toLowerCase();
      await requestReset(email, wrap.querySelector('#lrResetStatus'));
    };
  }

  function boot() {
    css();
    if (isRecoveryUrl()) startRecovery();
    const observer = new MutationObserver(() => {
      if (!recoveryMode) installForgotPassword();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    installForgotPassword();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
