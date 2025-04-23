# Cahoot Klone

A real-time quiz application inspired by Kahoot!, built with Node.js, Express, and Socket.IO. This repository contains both the backend server logic and the static frontend files served by the backend.

## Features

*   Real-time gameplay using Socket.IO.
*   Host and Player roles.
*   Dynamic loading of quizzes from `quizzes.json`.
*   Frontend built with vanilla HTML, CSS, and JavaScript.
*   Basic QR code generation for joining.

## Prerequisites

*   [Node.js](https://nodejs.org/)
*   [Git](https://git-scm.com/)

## Setup and Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/GodfreyDev/CahootKlone.git
    ```

2.  **Navigate to the project directory:**
    ```bash
    cd CahootKloneBackend
    ```

3.  **Install dependencies:** This command reads the `package.json` and installs the required libraries (Express, Socket.IO, etc.) into the `node_modules` folder.
    ```bash
    npm install
    ```

## Running the Application

1.  **Start the server:**
    ```bash
    node server.js
    ```
    The server will start, load quizzes, set up Socket.IO listeners, and begin serving the frontend files from the `public` directory. Look for output indicating the server is listening (e.g., "Server listening on port 3000").

2.  **Access the application:** Open your web browser and navigate to:
    ```
    http://localhost:3000
    ```

## Project Structure

*   **`server.js`**: The main backend file. It sets up the Express server, initializes Socket.IO, handles connections, manages game state, loads quizzes, and serves static files.
*   **`public/`**: Contains the static frontend files.
    *   `index.html`: The main HTML structure for the user interface.
    *   `style.css`: Contains all the CSS rules for styling the application.
    *   `gameLogic.js`: Contains the client-side JavaScript logic for interacting with the server via Socket.IO, handling UI updates, user input, etc.
*   **`quizzes.json`**: A JSON file storing the different quizzes, questions, options, and correct answers used by the game.
*   **`package.json`**: Defines project metadata, dependencies, and scripts.
*   **`package-lock.json`**: Records the exact versions of dependencies used, ensuring consistent installations.
*   **`.gitignore`**: Specifies files and directories that Git should ignore (e.g., `node_modules`).
*   **`README.md`**: This file, providing information about the project.

## Development Notes

*   The server uses Express to serve the static files located in the `public` directory.
*   Real-time communication between the server and clients is handled using Socket.IO.
