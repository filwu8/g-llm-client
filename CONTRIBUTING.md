# Contributing to G-LLM Desktop Client

Thank you for considering a contribution to G-LLM Desktop Client.

## Before You Contribute

G-LLM Desktop Client V1.1.0 and later source releases are licensed under the
Business Source License 1.1 (`BUSL-1.1`) with the parameters stated in
[LICENSE](./LICENSE). V1.0.10 and earlier remain under the license included in
their corresponding release tags.

By submitting a contribution, you confirm that:

1. you created the contribution or otherwise have the right to submit it;
2. the contribution does not knowingly include confidential information,
   trade secrets, or code that you are not authorized to provide;
3. third-party code and assets are identified with their source and license;
4. you grant GPROPHET LIMITED a perpetual, worldwide, irrevocable,
   non-exclusive, royalty-free copyright license to use, reproduce, modify,
   distribute, sublicense, relicense, and commercially license the
   contribution as part of G-LLM Desktop Client; and
5. your contribution may be released under the current source license, a
   future version of that license, the stated Change License, or a separate
   commercial license.

This contribution grant does not transfer ownership of your copyright. For a
material contribution, GPROPHET LIMITED may require a separately signed
Contributor License Agreement before accepting it.

Do not submit a contribution if you cannot make these confirmations.

## Development Workflow

- Open an issue or discussion before substantial architectural work.
- Keep changes focused and include tests appropriate to the affected behavior.
- Run `pnpm build` before submitting a change.
- Preserve copyright, SPDX, license, attribution, and trademark notices.
- Do not commit credentials, customer data, private prompts, or licensed assets
  that are not intended for source distribution.

## Third-Party Dependencies

New dependencies must have a documented license compatible with this project.
When dependencies change, run `pnpm licenses:generate` and include the updated
`THIRD_PARTY_NOTICES.md` in the contribution.

## Security Reports

Do not disclose a suspected vulnerability in a public issue. Contact
`security@gprophet.com` with enough detail to reproduce and assess the issue.

## Commercial and Brand Questions

For commercial licensing or trademark authorization, contact
`licensing@gprophet.com`. See [COMMERCIAL_LICENSE.md](./COMMERCIAL_LICENSE.md)
and [TRADEMARKS.md](./TRADEMARKS.md).
