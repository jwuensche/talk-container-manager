var form = document.getElementById('toolbar');
form.addEventListener('submit', function(event) {
    var uri = document.location.origin + '/terminal/' +
        document.getElementById('name').value;
    document.getElementById('console').src = uri;
    event.preventDefault();
}, false);
