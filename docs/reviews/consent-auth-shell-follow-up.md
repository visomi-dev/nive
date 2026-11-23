# Consent, Google loading, and authenticated shell

This follow-up starts at `415711d`. The continuous workspace uses the pre-#34 shell at `cbcc871` as a visual reference and retains the current navigation, dashboard, and mobile drawer.

## Consent confirmation

A fresh grant from the compact notice replaces the choices with the localized thank-you and a 10-second countdown. The progress and changing number are visual. The stable status region announces the thank-you once. The timer is attached to the current grant and stops on revocation, browser privacy signals, or navigation. Astro loads the countdown code on Share and uses the original grant time when the code arrives. Dismissal leaves the choice saved. The Privacy settings page still displays the current choice and allows revocation.

| Surface | Desktop, light, EN | Mobile, dark, es-MX |
| ------- | ------------------ | ------------------- |

## Google button

The shared button reserves the configured Google control width and its 40 px button height inside the existing 44 px slot. The neutral skeleton is static and noninteractive. It covers provider discovery and SDK rendering. Disabled and failed discovery remove it. SDK errors retain the existing retry action.

| Flow | Loading | Rendered fixture |
| ---- | ------- | ---------------- |

## Authenticated shell

The shell keeps the header stationary, scrolls the full-width main region, and centers the content inside it. The existing dashboard cards own their own surfaces. The sidebar and drawer place the localized Privacy link beneath the account trigger. The four top-level account actions retain their destinations, and the Security settings disclosure retains its child links and active-route treatment.

The captures use a local Chromium fixture with synthetic accounts and dashboard data. The Google script and button are synthetic fixtures. Browser tests control elapsed time for the consent countdown and compare button and neighboring control positions before and after loading. The shell tests measure the scrollbar owner's right edge and verify keyboard reachability, focus return, route links, and document scroll containment across Chromium, Firefox, and WebKit.
