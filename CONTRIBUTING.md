# Contributing

Thanks for taking the time to help. Bug reports, translations and pull requests are all welcome.

## Reporting a bug

Open an issue with the **Bug report** template. Include the bot version (`package.json`), your Node.js version, where it runs (ACLClouds, VPS, your computer), the command you ran and the console output around the error. Remove your token and any other secret from logs before posting them.

Security problems (a way to bypass a protection, to reach the dashboard without permission, to leak a token) should not be posted publicly. Contact the maintainers through https://aclclouds.com instead.

## Making a change

1. Fork the repository and create a branch from `main`.
2. Read [docs/DEVELOPING.md](docs/DEVELOPING.md): it explains how modules, commands, translations and the dashboard schema fit together.
3. Keep the change focused. Follow the style of the surrounding code: CommonJS, 2 spaces, semicolons, single quotes, files under about 400 lines, comments that explain why.
4. Every user-visible string goes through `t()` and must exist in both languages (`locales/ar` and `locales/en` must have exactly the same keys).
5. Do not add runtime dependencies without discussing it in an issue first. The bot has to keep running in 315 MB of RAM with no native addons.
6. Run the checks before opening the pull request:

   ```bash
   npm test
   npm run check
   npm run dry-run
   ```

7. In the pull request, say what changed, why, and how you tested it (on a real server if the change touches Discord behavior).

## Commit messages

Use short, imperative messages, for example `fix(tickets): keep the claim button after a restart`.

## License

By contributing, you agree that your contribution is released under the [MIT license](LICENSE).
