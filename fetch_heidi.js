const fs = require('fs');
fetch('https://raw.githubusercontent.com/HeidiSQL/HeidiSQL/master/source/helpers/dbhelper.pas')
    .then(res => res.text())
    .then(text => console.log(text.substring(0, 100)));
