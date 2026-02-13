import { CavalryPlayer } from './CavalryPlayer.js';

async function initialise() {
    const container = document.getElementById('player');
    try {
        if (!container) {
            throw new Error('Elemento #player non trovato nell\'HTML');
        }

        const player = new CavalryPlayer(container, {
            config: {
                // Questo forza il browser a cercare nella TUA cartella wasm-lib
                locateFile: (path) => `./wasm-lib/${path}`
            },
            controlCentre: true
        });

        // Carica finalmente la giraffa
        await player.load('./scene.cv');
        
        document.getElementById('loading')?.remove();
        console.log("Cavalry Player inizializzato con successo!");
    } catch (error) {
        console.error("Errore fatale:", error);
        document.getElementById('loading').innerText = "Errore nel caricamento. Controlla la console.";
    }
}

initialise();
