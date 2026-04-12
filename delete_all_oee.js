import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, deleteDoc, doc } from 'firebase/firestore';
import fs from 'fs';

const config = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(config);
const db = getFirestore(app, config.firestoreDatabaseId);

async function deleteAll() {
    const snapshot = await getDocs(collection(db, 'cable_operations'));
    let count = 0;
    for (const d of snapshot.docs) {
        await deleteDoc(doc(db, 'cable_operations', d.id));
        count++;
    }
    console.log(`Deleted ${count} documents.`);
    process.exit(0);
}
deleteAll();
