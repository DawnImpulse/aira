import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { api } from "../ipc";
import { cancelPairing, logOut, renamePhone, sendLink, startPairing, unpair, usePhone, type RoomState } from "../lib/phone";
import { notify } from "../store";
import { cx, Icon } from "./ui";

const LABEL: Record<RoomState, string> = { idle: "not connected", connecting: "connecting…", connected: "connected", error: "error" };

/** Settings → Phone: sign in with the account the phone uses, then pair phones by QR (lib/phone). */
export function PhoneSettings() {
  const { user, phones, linkSent, pairing, rooms } = usePhone();
  const [email, setEmail] = useState(localStorage.getItem("phone.email") ?? "");
  const [qr, setQr] = useState("");
  useEffect(() => {
    if (!pairing) return setQr("");
    QRCode.toDataURL(pairing.secret, { margin: 1, width: 440 }).then(setQr).catch(notify);
  }, [pairing]);
  useEffect(() => cancelPairing, []); // closing Settings abandons a QR nobody scanned

  if (user === undefined) return <small className="dim">Loading…</small>;
  if (!user)
    return (
      <>
        <small className="dim">Watch and drive your terminals from the Aira phone app. Sign in with the account the phone uses; a link in your email finishes it on this Mac.</small>
        <label className="field">
          <span>Email</span>
          <div className="row gap">
            <input type="email" className="grow" value={email} placeholder="you@example.com" autoComplete="email" onChange={(e) => setEmail(e.target.value)} />
            <button type="button" className="btn primary" disabled={!/.+@.+\..+/.test(email)} onClick={() => sendLink(email.trim()).catch(notify)}>
              Send sign-in link
            </button>
          </div>
        </label>
        {linkSent && <small className="dim">Check your email and open the link on this Mac. Nothing happened? Send it again.</small>}
      </>
    );

  return (
    <>
      <div className="row gap">
        <span className="grow">
          Signed in as <b>{user.email}</b>
        </span>
        <button type="button" className="btn" onClick={() => logOut().catch(notify)}>
          Sign out
        </button>
      </div>
      {phones.length > 0 && (
        <div>
          {phones.map((p) => {
            const r = rooms[p.roomId];
            return (
              <div key={p.roomId} className="phone-row" title={r?.error}>
                <Icon name="smartphone" size={16} />
                <input defaultValue={p.name} aria-label="Phone name" onBlur={(e) => e.target.value !== p.name && renamePhone(p.roomId, e.target.value.trim() || p.name).catch(notify)} />
                <span className={cx("dim", r?.state === "connected" && "green")}>{r?.error ?? LABEL[r?.state ?? "idle"]}</span>
                <button type="button" className="btn" onClick={() => unpair(p.roomId).catch(notify)}>
                  Unpair
                </button>
              </div>
            );
          })}
        </div>
      )}
      {pairing ? (
        <div className="pair-box">
          {qr && <img src={qr} width={220} height={220} alt="Pairing code" />}
          <small className="dim">Scan with the Aira phone app, or paste the code there:</small>
          <div className="row gap">
            <code className="path-box">{pairing.secret}</code>
            <button type="button" className="btn" onClick={() => api.copyText(pairing.secret).catch(notify)}>
              Copy
            </button>
          </div>
          <div className="row gap">
            <span className="dim">Waiting for the phone…</span>
            <button type="button" className="btn" onClick={cancelPairing}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="row gap">
          <button type="button" className="btn primary" onClick={() => startPairing().catch(notify)}>
            Pair a phone
          </button>
        </div>
      )}
      <small className="dim">
        <Icon name="lock" size={12} /> Each code is a secret only this Mac and that phone know, kept in your macOS Keychain. Terminal data goes phone to Mac directly; a push when an agent needs input follows the Notifications setting.
      </small>
    </>
  );
}
