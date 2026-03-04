# DimaBot

DimaBot is a feature-rich Twitch chat bot designed to enhance streams with a wide range of commands, moderation tools, and interactive features. It is highly customizable and integrates with various services to provide a seamless experience for both streamers and viewers.

The bot is powered by a Node.js backend and communicates with Twitch chat via TMI.js. It also includes a web server built with Express, which serves an API for the [domdimabot.com](https://domdimabot.com) website, where users can register and manage their bot settings.

## Features

-   **Command System:** A robust command system with a wide range of default commands and the ability to create custom commands.
-   **Moderation:** Tools to help moderate your channel, including adding/removing moderators and VIPs, banning users, and more.
-   **AI Integration:** Integration with Google Gemini to provide an AI-powered chat personality that can interact with users and perform moderation tasks.
-   **Interactive Commands:** Fun and interactive commands like duels, polls, predictions, and various "meters" (`amor`, `furrometro`, `sumimetro`).
-   **Song Requests:** Integration with Spotify for song requests.
-   **EventSub Support:** Handles Twitch EventSub notifications for events like follows, subscriptions, and raids.
-   **Web Dashboard:** A web-based dashboard (via `domdimabot.com`) for easy configuration and management.
-   **File Storage:** Uses AWS S3 for storing files related to triggers and other features.
-   **Caching:** Utilizes DragonflyDB (Redis-compatible) for caching to ensure fast response times.

## Prerequisites

Before you begin, ensure you have the following installed:

-   [Node.js](https://nodejs.org/) (v18 or higher recommended)
-   [MongoDB](https://www.mongodb.com/)
-   [DragonflyDB](https://www.dragonflydb.io/) or [Redis](https://redis.io/)
-   An AWS account with an S3 bucket
-   A Google Gemini API key

## Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/your-username/dimabot.git
    cd dimabot
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

## Configuration

The application is configured using environment variables. Create a `.env` file in the root of the project and add the following variables:

```env
# General
PRODUCTION=0 # 1 for production, 0 for development (deprecated, use ENVIRONMENT instead)
ENVIRONMENT=dev # 'production', 'dev', or 'test'

# Test Environment (only used when ENVIRONMENT=test)
TEST_CHANNELS=channel1,channel2 # Comma-separated list of channels to join in test mode

# Twitch Bot Account Credentials
TWITCH_USERNAME=your_bot_twitch_username
User_Token_Auth=oauth:your_twitch_oauth_token # Get from https://twitchapps.com/tmi/

# Database
MONGO_URI=mongodb://localhost:27017/dimabot

# Cache (DragonflyDB/Redis)
DRAGONFLY_PORT=6379
DRAGONFLY_HOST=127.0.0.1

# AI (Google Gemini)
GOOGLE_GEMINI_API_KEY=your_google_gemini_api_key

# AWS S3
S3_REGION=your_s3_bucket_region
S3_ENDPOINT=s3.amazonaws.com # or your custom endpoint
S3_ACCESS_KEY=your_s3_access_key
S3_SECRET_KEY=your_s3_secret_key
S3_BUCKET=your_s3_bucket_name
S3_PUBLIC_URL=https://your_s3_bucket_name.s3.your_s3_bucket_region.amazonaws.com # Optional
```

## Running the Application

The application consists of two main parts: the web server and the Twitch bot. You can run them in separate terminals.

-   **To run the web server:**
    ```bash
    npm run start
    ```

-   **To run the Twitch bot:**
    ```bash
    npm run bot
    ```

-   **To run the Twitch bot in test mode:**
    ```bash
    npm run test-bot
    ```
    Test mode enables detailed logging of all IRC messages and their tags for debugging purposes. Make sure to set `TEST_CHANNELS` in your `.env` file to specify which channels to join.

Both will run with `nodemon`, which will automatically restart the application when file changes are detected.

## Cron Workers

The cron supervisor manages background workers for tasks like follow ledger tracking and stream analytics. The supervisor runs from `src/workers/cron.index.ts` (built as `dist/workers/cron.index.js`).

### Running Cron Workers

-   **Normal mode (persistent, auto-restart):**
    ```bash
    node dist/workers/cron.index.js
    ```

-   **Dry-run mode (for testing, no actual work):**
    ```bash
    node dist/workers/cron.index.js --dry-run
    ```

-   **Once mode (run once and exit, no restart):**
    ```bash
    node dist/workers/cron.index.js --once
    ```

-   **Dry-run + once mode (CI-safe smoke test):**
    ```bash
    node dist/workers/cron.index.js --dry-run --once
    ```
    This runs all workers once in dry-run mode and exits with code 0 if all workers succeed, or code 1 if any worker fails. Useful for smoke testing in CI/CD pipelines.

## How to Use (Bot Commands)

The bot responds to commands in the Twitch chat. The default prefix is `!`, but this can be customized. Here is a list of some of the available commands:

| Command               | Description                                                               |
| --------------------- | ------------------------------------------------------------------------- |
| `!addmoderator`       | Adds a user as a moderator in the bot's context.                          |
| `!addvip`             | Adds a user as a VIP in the bot's context.                                |
| `!amor`               | An "love meter" that calculates the love between two users.               |
| `!command`            | Manages custom commands (add, edit, delete).                              |
| `!commandlist`        | Displays a list of all available commands.                                |
| `!countdowntimer`     | Starts a countdown timer in the chat.                                     |
| `!createclip`         | Creates a Twitch clip.                                                    |
| `!disablecommand`     | Disables a command.                                                       |
| `!duel`               | Starts a duel between two users.                                          |
| `!enablecommand`      | Enables a previously disabled command.                                    |
| `!followage`          | Checks how long a user has been following the channel.                    |
| `!furrometro`         | A "furry meter" to check how "furry" a user is.                           |
| `!game`               | Displays or updates the current game being played on stream.              |
| `!mecabe`             | A fun, likely inside-joke command.                                        |
| `!memide`             | A "size meter" command.                                                   |
| `!miyuloot`           | A loot-related command, possibly for a custom game.                       |
| `!onlyemotes`         | Toggles emote-only mode in the chat.                                      |
| `!pechos`             | A "chest meter" command.                                                  |
| `!poll`               | Creates and manages polls in the chat.                                    |
| `!ponerla`            | A fun, likely inside-joke command.                                        |
| `!prediction`         | Creates and manages Twitch predictions.                                   |
| `!promo`              | Promotes another streamer or social media.                                |
| `!removemoderator`    | Removes a user as a moderator in the bot's context.                       |
| `!removevip`          | Removes a user as a VIP in the bot's context.                             |
| `!ruletarusa`         | Starts a game of Russian Roulette.                                        |
| `!shoutout`           | Gives a shoutout to another streamer.                                     |
| `!speach`             | Makes the bot speak a message using text-to-speech.                       |
| `!spotifysongrequest` | Requests a song to be played via Spotify.                                 |
| `!sumimetro`          | A "submissive meter" to check how "submissive" a user is.                 |
| `!timercommand`       | Manages timed commands.                                                   |
| `!title`              | Displays or updates the stream title.                                     |
| `!vanish`             | Makes a user's messages disappear (like a timeout of 1 second).           |

---

This project is the backend for the [domdimabot.com](https://domdimabot.com) website. User registration and bot management are handled through the site. For more detailed information on how to configure specific features, please refer to the website's dashboard once you have registered.
