import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({plugins:[react()],root:'web',publicDir:'../public',server:{host:'127.0.0.1',port:5182,strictPort:true,fs:{allow:['..']},proxy:{'^/api/':'http://127.0.0.1:8782'}},build:{outDir:'../dist',emptyOutDir:true}});
