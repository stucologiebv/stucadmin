@echo off
echo Uploading updated files to server...
scp -i C:\Users\Secure-DLT\.ssh\id_rsa "%~dp0server_updated.js" info@34.7.129.44:~/stucadmin/server.js
scp -i C:\Users\Secure-DLT\.ssh\id_rsa "%~dp0medewerker-portal_updated.html" info@34.7.129.44:~/stucadmin/medewerker-portal.html
echo Done! Now restart PM2...
ssh -i C:\Users\Secure-DLT\.ssh\id_rsa info@34.7.129.44 "cd ~/stucadmin && pm2 restart stucadmin"
pause
