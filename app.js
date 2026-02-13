import { CavalryPlayer } from './CavalryPlayer.js';

async function initialise() {
    const container = document.getElementById('player');
    try {
        if (!container) {
            throw new Error('Missing div element with id "player"');
        }

        // Creiamo il player indicando dove sono i file WASM
        const player = new CavalryPlayer(container, {
            config: {
                locateFile: (path) => `./wasm-lib/${path}`
            },
            controlCentre: true // Questo attiva gli slider!
        });

        // Carichiamo il tuo file specifico
        await player.load('./scene.cv');
        
        document.getElementById('loading')?.remove();
    } catch (error) {
        console.error(error);
        const div = document.createElement('div');
        div.style.color = "white";
        div.style.textAlign = "center";
        div.innerText = `Errore: ${error.message}`;
        document.getElementById('loading')?.remove();
        container?.appendChild(div);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialise);
} else {
    initialise();
}