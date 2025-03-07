const { onRequest } = require('firebase-functions/v2/https');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { Client } = require('@notionhq/client');
const dotenv = require('dotenv');

// notion config
const NOTION_TOKEN = "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"
const NOTION_DATABASE_ID = "19fc6a455de88026bb6ff62e459ed1d1"

// Environment Configuration
const NODE_ENV = "development"

// instalar @notionhq/client
// npm install @notionhq/client

dotenv.config();

// Inicializar Firebase Admin
initializeApp();

// Inicializar Notion Client
const notion = new Client({
    auth: process.env.NOTION_TOKEN
});

// Función auxiliar para convertir Timestamp de Firebase a formato ISO
const formatDate = (timestamp) => {
    if (!timestamp) return null;
    const date = timestamp.toDate();
    return date.toISOString().split('T')[0];
};

const getHomeData = async (homeData) => {
    const db = getFirestore();
    const homeSnapshot = await db.collection('homes')
        .where('hid', '==', homeData.hid)
        .get();

    if (!homeSnapshot.empty) {
        return homeSnapshot.docs[0].data();
    }
    return null;
};

const getUserData = async (userData) => {
    const db = getFirestore();
    const homeSnapshot = await db.collection('users')
        .where('uid', '==', userData.uid)
        .get();

    if (!homeSnapshot.empty) {
        return homeSnapshot.docs[0].data();
    }
    return null;
};

// estructura de datos para Notion
const createNotionData = async (npsData) => {
    const homeData = await getHomeData(npsData);
    const homeName = homeData ? homeData.name : npsData.hid;
    const homeLocation = homeData ? homeData.location : null;

    const userData = await getUserData(npsData);
    const userName = userData ? userData.name : npsData.uid;

    const properties = {
        'Casa': {
            title: [
                {
                    text: {
                        content: homeName || 'Sin especificar'
                    }
                }
            ]
        },
        'NPS': {
            number: npsData.nps || 0
        },
        'Comentario': {
            rich_text: [
                {
                    text: {
                        content: npsData.comment || ''
                    }
                }
            ]
        },
        'Fecha': {
            date: {
                start: formatDate(npsData.date) || new Date().toISOString()
            }
        },
        'Propietarios': {
            rich_text: [
                {
                    text: {
                        content: userName || 'Sin especificar'
                    }
                }
            ]
        }
    };

    // Solo añadir Destino si existe
    if (homeLocation) {
        properties['Destino'] = {
            select: {
                name: homeLocation || 'Sin destino'
            }
        };
    }

    return {
        parent: {
            database_id: process.env.NOTION_DATABASE_ID,
        },
        properties
    };
};

const migrateToNotion = onRequest({
    timeoutSeconds: 540,
    memory: '256MiB'
}, async (request, response) => {
    try {
        const db = getFirestore();
        let migratedCount = 0;
        let errorCount = 0;
        const errors = [];

        // CAMBIAR POR NOMBRE DE TABLA BUENA --> nps-booking
        const snapshot = await db.collection('nps-booking')
            .where('round', '==', 'home')
            .get();

        if (snapshot.empty) {
            return response.json({
                message: 'No hay documentos para migrar',
                migratedCount: 0
            });
        }

        for (const doc of snapshot.docs) {
            try {
                const data = doc.data();
                await notion.pages.create(await createNotionData(data));
                migratedCount++;
                console.log(`Migrado documento ${doc.id} correctamente`);
            } catch (docError) {
                errorCount++;
                errors.push({
                    docId: doc.id,
                    error: docError.message
                });
                console.error(`Error migrando documento ${doc.id}:`, docError);
            }
        }

        response.json({
            success: true,
            summary: {
                total: snapshot.size,
                migrated: migratedCount,
                failed: errorCount,
                errors: errors
            }
        });

    } catch (error) {
        console.error('Error en la migración:', error);
        response.status(500).json({
            success: false,
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

const syncNewNPSToNotion = onDocumentCreated('nps-booking/{docId}', async (event) => {
    try {
        const snapshot = event.data;
        if (!snapshot) {
            console.log('No data associated with the event');
            return;
        }

        const data = snapshot.data();

        if (data.round !== 'home') {
            console.log('Documento no es de tipo home, ignorando');
            return;
        }

        await notion.pages.create(await createNotionData(data));
        console.log(`Creado nuevo registro en Notion para documento ${snapshot.id}`);

    } catch (error) {
        console.error('Error sincronizando con Notion:', error);
        throw error;
    }
});

// Exportar las funciones
module.exports = {
    migrateToNotion,
    syncNewNPSToNotion
};