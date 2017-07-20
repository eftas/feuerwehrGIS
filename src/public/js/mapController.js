var app = angular.module("sandbox", ["ngRoute"]);
var map, drawnItems, drawControl, basemap;
var lines,
    linesArray = [];
var commentsMap = new Map();
var windowManager = require('electron').remote.require('electron-window-manager');

app.directive('droppable', function() {
    return {
        scope: {
            drop: '&' // parent
        },
        link: function(scope, element) {
            // again we need the native object
            var el = element[0];
            el.addEventListener(
                'drop',
                function(e) {
                    // Stops some browsers from redirecting.
                    if(e.preventDefault) e.preventDefault();
                    if(e.stopPropagation) e.stopPropagation();
                    scope.drop({element:e});
                    return false;
                },
                false
            );
        }
    }
});

app.config(function ($routeProvider) {
    $routeProvider
        .when('/map', {
            templateUrl: '../public/app/templates/fgis/map.html',
            controller: 'mapCtrl'
        })
        .otherwise({
            templateUrl: '../public/app/templates/fgis/map.html',
            controller: 'mapCtrl'
        })
});

app.controller("mapCtrl", function($scope, $http) {
        // This function is activated as soon as an element is moved by drag and drop.
        // The position in the map has to be adjusted again
        $scope.handleDrop = function(element) {
            var startId = element.dataTransfer.getData("text");
            var startElement = document.getElementById(startId);
            // we drop onto the fieldText or svg, so we need to access the parent field-div
            var targetElement = element.target.parentNode;
            // if we drop onto the svg polygon element, we need to go one level higher
            if (!$(targetElement).hasClass('fields'))
                targetElement = targetElement.parentNode;
            var targetId = targetElement.id;

            //save the texts:
            var _imageTarget      = $('#image' + targetId).attr('src');
            var _textTopTarget    = $('#fieldTextTop' + targetId).html();
            var _textBottomTarget = $('#fieldTextBottom' + targetId).html();
            var _commentTarget    = $('#fieldComment' + targetId).html();
            var _imageStart       = $('#image' + startId).attr('src');
            var _textTopStart     = $('#fieldTextTop' + startId).html();
            var _textBottomStart  = $('#fieldTextBottom' + startId).html();
            var _commentStart     = $('#fieldComment' + startId).html();

            //swap the images and texts
            startElement.innerHTML = getFieldHtmlString(
                startId, _imageTarget, _commentTarget,
                _textTopTarget, _textBottomTarget
            );

            targetElement.innerHTML = getFieldHtmlString(
                targetId, _imageStart, _commentStart,
                _textTopStart, _textBottomStart
            );
            var elements = [];
            //  An element is moved from a to b. The position in the map must be retained.
            //  The new position and the original location in the map are saved
            if (linesArray[startId]) {
                // Only in this case, the position on the map is also stored in the object.
                // By drag & drop, the element is first removed and then re-marked. When deleting, the position in the map is lost, this must be saved. So the position on the map is stored in the object.
                elements.push({
                    'mappos': linesArray[startId][3],
                    'fieldid': parseInt(targetId)
                });
            }
            // An element already exists at the position b, then this is moved from b to a. Both elements exchange their places
            if (linesArray[targetId]) {
                elements.push({
                    'mappos': linesArray[targetId][3],
                    'fieldid': parseInt(startId)
                });
            }

            // If an element is moved, the old position is first deleted and then redrawn
            $scope.fields.deleteLocationOnMap(parseInt(startId));
            $scope.fields.deleteLocationOnMap(parseInt(targetId));
            // The elements are re-drawn
            $scope.fields.addLine(elements);
        };
        // url of the local server
        $scope.localAddress = 'http://localhost:1337/';

        /********************************
         ********  loading/saving ********
         ********************************/

        // object that will contain the current state on save
        $scope.einsatz = {
            id: 0,
            // rest will be filled on save()
            drawnObjects: [],
            taktZeichen: [],
            map: {
                zoom: 0,
                center: {},
                tileServer: ''
            }
        };

        windowManager.bridge.on('submitField', function(value) {
            $scope.fields.submit(value.fieldTop, value.fieldBottom, value.imageSrc, value.fieldComment);
        });

        windowManager.bridge.on('changeColour', function(value) {
            $scope.map.changeGeomStyle(value);
        });

        windowManager.bridge.on('handleObject', function(value) {
            if (value === 'edit') $scope.map.editObjects();
            else if (value === 'delete') $scope.map.deleteObjects();
            else if (value === 'save') $scope.map.editSave();
            else if (value === 'cancel') $scope.map.editCancel();
        });

        windowManager.bridge.on('delete', function(value) {
            if (value == 'deleteLine') {
                $scope.fields.deleteLocationOnMap($scope.fields.currentField.id);
            } else if (value == 'deleteSymbol') {
                $scope.fields.delete();
            }
        });

        windowManager.bridge.on('dbEntry', function(value) {
            $scope.loadEinsatz(value.id);
        });

        windowManager.bridge.on('saveMission', function () {
            $scope.saveEinsatz();
        });

        windowManager.bridge.on('newMission', function () {
            $scope.resetMap();
        });

        windowManager.bridge.on('deleteEntry', function () {
            $scope.deleteEntry();
            $scope.resetMap();
        });

        windowManager.bridge.on('showBasemap', function (value) {
            $scope.map.showBasemap(value.wms, value.layer);
        });

        $scope.resetMap = function () {
            drawnItems.clearLayers();
            lines.clearLayers();
            linesArray = [];
            $scope.fields.delete();
            // All fields are reset
            for (var i = 0; i < $scope.fields.fieldOrder.properties.length; i++) {
                document.getElementById($scope.fields.fieldOrder.properties[i].id).innerHTML = getFieldHtmlString($scope.fields.fieldOrder.properties[i].id, '', '', '', '');
                $('#' + $scope.fields.fieldOrder.properties[i].id).removeClass("activated");
            }

            $scope.$apply(function () {
                $scope.einsatz = {
                    time: '',
                    id: 0,
                    // rest will be filled on save()
                    drawnObjects: [],
                    taktZeichen: [],
                    map: {
                        zoom: 0,
                        center: {},
                        tileServer: ''
                    }
                };
            });
        };

        /**
         * The current dataset is removed from the database.
         */
        $scope.deleteEntry = function () {
            if ($scope.einsatz.id) {
                $http.delete($scope.localAddress + 'api/deleteEntry/' + $scope.einsatz.id)
                    .then(function successCallback(response) {
                        if (response.data.result) {
                            windowManager.bridge.emit('reloadSecWin', true);
                        }
                    });
            }
        };

        /**
         * serializes the current state into $scope.einsatz & pushs it to the DB server
         */
        $scope.saveEinsatz = function() {
            var date = new Date();
            // Readable time string
            $scope.einsatz.time = date.toLocaleString();
            // Current timestamp in ms
            $scope.einsatz.id = date.getTime();
            // copy field data into $scope.einsatz.fields
            $scope.einsatz.taktZeichen = [];
            for (var i = 0; i < $scope.fields.fieldOrder.properties.length; i++) {
                var kranzPos = $scope.fields.fieldOrder.properties[i].id;
                var line = linesArray[kranzPos];

                $scope.einsatz.taktZeichen.push({
                    kranzposition: kranzPos,
                    kartenposition: line ? [line[0],line[2],line[3]] : '',
                    zeichen:    $('#image' + kranzPos).attr('src') || '',
                    comment:    $('#fieldComment' + kranzPos).text() || '',
                    textTop:    $('#fieldTextTop' + kranzPos).text() || '',
                    textBottom: $('#fieldTextBottom' + kranzPos).text() || ''
                });
            }

            // push drawn object data into $scope.einsatz.drawnObjects
            $scope.einsatz.drawnObjects = [];
            drawnItems.eachLayer(function(layer) {
                var geojson = layer.toGeoJSON();
                geojson.properties.comment = commentsMap.get(drawnItems.getLayerId(layer)) || '';
                geojson.properties.color = layer.options.color || '';
                // as leaflet draw serializes a circle as a point, we need to store the radius manually.
                if (layer._mRadius) geojson.properties.circleRadius = layer._mRadius;
                $scope.einsatz.drawnObjects.push(geojson);
            });
            // save map state
            $scope.einsatz.map.zoom = map.getZoom();
            $scope.einsatz.map.center = map.getCenter();
            $scope.einsatz.map.tileServer = '';

            /**
             * A new entry is added to the database.
             */
            function postEntry() {
                $http.post($scope.localAddress + 'api/addEntry/', $scope.einsatz)
                    .then(function successCallback(response) {
                        if (response.data.result) {
                            // The table is updated
                            windowManager.bridge.emit('reloadSecWin', true);
                        }
                    });
            }

            if ($scope.einsatz.id) {
                postEntry();
            }
        };

        /**
         * loads a einsatz identified by its ID
         */
        $scope.loadEinsatz = function(id) {
            if (!isNaN(parseInt(id))) {
                $http.get($scope.localAddress + 'api/getEntry/' + id)
                    .then(function successCallback(response) {
                        if (response.data.result) updateState(response.data.metadata);
                    });
            }

            function updateState(einsatz) {
                // store new einsatz data in $scope.einsatz reset from previous state
                $scope.einsatz = einsatz;
                lines.clearLayers();
                linesArray = [];
                drawnItems.clearLayers();

                // insert drawnObjects
                for (var i = 0; i < $scope.einsatz.drawnObjects.length; i++) {
                    // convert geojson -> FeatureGroup -> ILayer
                    var geojson = $scope.einsatz.drawnObjects[i];
                    var featureGroup = L.geoJson(geojson, {
                        pointToLayer: function(json, latlng) {
                            if(json.properties.circleRadius) {
                                return new L.circle(latlng, json.properties.circleRadius, {
                                    fillColor: json.properties.color,
                                    color: json.properties.color,
                                    weight: 5
                                });
                            } else { return new L.marker(latlng); }
                        }
                    });
                    var layer = featureGroup.getLayers()[0]; // extract the first (and only) layer from the fGroup
                    layer.options.style = { color: geojson.properties.color };
                    layer.options.color = geojson.properties.color;
                    if (geojson.properties.circleRadius) layer.feature.geometry.type = 'circle';
                    drawnItems.addLayer(layer);

                    // register comment
                    var layerID = drawnItems.getLayerId(layer);
                    commentsMap.set(layerID, geojson.properties.comment);

                    // register click events
                    layer.on('click', function(e){
                        $scope.map.objectClicked(e.target.feature.geometry.type, e.target, e.target._leaflet_id);
                    });
                }

                // make layers unclickable by default
                drawnItems.eachLayer(function(layer) {
                    setClickable(layer, false);
                });

                // upate mapstate
                map.setView($scope.einsatz.map.center, $scope.einsatz.map.zoom);
                // setze taktische zeichen in karte
                for (var i = 0; i < $scope.einsatz.taktZeichen.length; i++) {
                    var field = $scope.einsatz.taktZeichen[i];
                    var mapPosition = field.kartenposition;

                    var fieldHtml = getFieldHtmlString(field.kranzposition, field.zeichen,
                        field.comment, field.textTop, field.textBottom);

                    $('#' + field.kranzposition).html(fieldHtml);

                    // field line / kartenposition
                    if (field.kartenposition == '') {
                        continue; // field has no kartenposition
                    } else if (field.kartenposition[1] != null ) {
                        mapPosition = map.containerPointToLatLng(field.kartenposition[0]);
                    }
                    var anchorPoint = getAnchorOfElement('image' + field.kranzposition);
                    linesArray[field.kranzposition] = [field.kartenposition[0], anchorPoint, field.kartenposition[1], field.kartenposition[2]];
                    fitAllLines(linesArray);
                }
            }
        };

        /********************************
         ************ Fields *************
         ********************************/

        $scope.fields = {};
        $scope.fields.fieldOrder = fieldOrder;
        $scope.fields.symbols = symbolProperties;
        $scope.fields.symbolsFilter = "";
        $scope.fields.currentField = {};
        $scope.fields.currentField.image = "images/symbols/_universal.svg";
        $scope.fields.currentField.topText = "";
        $scope.fields.currentField.bottomText = "";
        $scope.fields.currentField.commentField = "";
        $scope.fields.currentField.active = false;
        $scope.fields.currentField.id = undefined;
        $scope.fields.currentField.fieldTextTop = "";
        $scope.fields.currentField.fieldTextBottom = "";
        $scope.fields.currentField.fieldComment = "";

        /**
         * @desc activates a tz slot, shows the field-properties in the side-content
         */
        $scope.fields.register = function(field){
            var currentField = $('#' + $scope.fields.currentField.id);
            currentField.removeClass("activated");
            $scope.fields.deleteLastLine($scope.fields.currentField.id);

            // when the clicked field is already the active/current one: deselect it
            if ($scope.fields.currentField.id == field) {
                $scope.fields.cancel();
                return;
            }

            try{$scope.map.editCancel();}catch(e){}
            var thisImage = document.getElementById(field).getElementsByTagName('img');
            $scope.fields.currentField.id = field;
            $scope.fields.currentField.active = true;
            currentField = $('#' + field);
            currentField.addClass("activated"); //highlight

            drawnItems.eachLayer(function(layer) {
                setClickable(layer, false);
            });

            if(thisImage.length == 0){
                $scope.fields.currentField.image = "images/symbols/_universal.svg";
                $scope.fields.currentField.topText = "";
                $scope.fields.currentField.bottomText = "";
                $scope.fields.currentField.commentField = "";
                $scope.fields.currentField.fieldTextTop = "";
                $scope.fields.currentField.fieldTextBottom = "";
                $scope.fields.currentField.fieldComment = "";
            }
            else {
                $scope.fields.currentField.image = thisImage[0].src;
                $scope.fields.currentField.topText = "";
                $scope.fields.currentField.bottomText = "";
                $scope.fields.currentField.commentField = "";
                $scope.fields.currentField.fieldTextTop = document.getElementById('fieldTextTop'+field).innerHTML;
                $scope.fields.currentField.fieldTextBottom = document.getElementById('fieldTextBottom'+field).innerHTML;
                $scope.fields.currentField.fieldComment = document.getElementById('fieldComment'+field).innerHTML;
            }
            windowManager.bridge.emit('loadFieldContent', $scope.fields);
        };

        //submit the field ('bestaetigen')
        $scope.fields.submit = function(fieldTextTop, fieldTextBottom, imageUrl, fieldComment){
            if ($scope.fields.currentField.id) {
                $scope.fields.currentField.active = false;
                $scope.map.lastClick = null;
                if(linesArray[$scope.fields.currentField.id] != null){
                    $('#' + $scope.fields.currentField.id).removeClass("activated");
                }
                $scope.fields.currentField.fieldTextTop = fieldTextTop;
                $scope.fields.currentField.fieldTextBottom = fieldTextBottom;
                $scope.fields.currentField.image = imageUrl;
                $scope.fields.currentField.fieldComment = fieldComment;

                document.getElementById($scope.fields.currentField.id).innerHTML = getFieldHtmlString($scope.fields.currentField.id,$scope.fields.currentField.image,$scope.fields.currentField.fieldComment,$scope.fields.currentField.fieldTextTop,$scope.fields.currentField.fieldTextBottom);
            }
        };

        $scope.fields.cancel = function(){
            $scope.fields.currentField.active = false;
            $scope.map.lastClick = null;
            $('#' + $scope.fields.currentField.id).removeClass("activated");
            $scope.fields.deleteLastLine($scope.fields.currentField.id);
            $scope.fields.currentField.id = undefined;
        };

        $scope.fields.delete = function(){
            if ($scope.fields.currentField.id) {
                document.getElementById($scope.fields.currentField.id).innerHTML = getFieldHtmlString($scope.fields.currentField.id, '', '', '', '');

                $scope.fields.currentField.active = false;
                $('#' + $scope.fields.currentField.id).removeClass("activated");
                $scope.fields.currentField.id = null;
            }
        };

        /********** Lines ********/
        // The location of an element is deleted, in this case the assignments of other elements may need to be removed/changed.
        $scope.fields.deleteLocationOnMap = function(fieldid) {
            var currentFieldId = fieldid;
            // It is checked whether a dataset is available.
            if (linesArray[currentFieldId]) {
                // Left and right neighbor
                var leftItem = linesArray[currentFieldId - 1];
                var rightItem = linesArray[currentFieldId + 1];
                var elements = [];
                // Test whether a left neighbor exists
                if (leftItem) {
                    // Left neighbour is my son or my brother
                    if (leftItem[2] == currentFieldId || (leftItem[2] == linesArray[currentFieldId][2] && linesArray[currentFieldId][2] != null)) {
                        elements.push({'fieldid': currentFieldId - 1});
                    }
                }
                // Test whether a right neighbor exists
                if (rightItem) {
                    // Right neighbour is my son or my brother
                    if (rightItem[2] == currentFieldId || (rightItem[2] == linesArray[currentFieldId][2] && linesArray[currentFieldId][2] != null)) {
                        elements.push({'fieldid': currentFieldId + 1});
                    }
                }
                // The currently selected element will be reset
                linesArray[currentFieldId] = null;
                fitAllLines(linesArray);
                $scope.fields.addLine(elements);
            }
        };

        $scope.fields.updateLine = function(){
            if ($scope.fields.currentField.id) $scope.fields.addLine([{'fieldid': $scope.fields.currentField.id}]);
        };

        $scope.fields.addLine = function(elements){
            // aufbau des linesArray[]
            // [Position in der Karte, Position am Bildschirmrand, Nummer des Vaters, Originale Kartenposition vom element]
            if (elements.length > 0) {
                // Wenn das Attribut mappos existiert, dann wurde das element per drag & drop verschoben. in diesem fall wird ein klick in die karte simuliert.
                if (elements[0].mappos) $scope.map.lastClick = elements[0].mappos;
                var currentFieldId = elements[0].fieldid;
                var neighbourLeft = linesArray[currentFieldId - 1];
                var neighbourRight = linesArray[currentFieldId + 1];
                // Existiert bereits ein eintrag oder ist das feld leer und es wird zum erstenmal ein eintrag erstellt.
                if (linesArray[currentFieldId]) {
                    // Das ausgewählte element ist ein sohn und ist einem element zugewiesen. in diesem fall müssen die nachbarn überprüft werden, ob diese ebenfalls söhne vom gleichen vater sind.
                    if (linesArray[currentFieldId][2]) {
                        // Es müssen nur Elemente betrachtet werden die den gleichen Vater haben
                        if (neighbourLeft) {
                            // der linke nachbar ist ebenfalls der sohn vom selben vater
                            if (neighbourLeft[2] == linesArray[currentFieldId][2]) {
                                elements.push({
                                    "fieldid": currentFieldId - 1
                                })
                            }
                        }
                        if (neighbourRight) {
                            // der rechte nachbar ist ebenfalls der sohn vom selben vater
                            if (neighbourRight[2] == linesArray[currentFieldId][2]) {
                                elements.push({
                                    "fieldid": currentFieldId + 1
                                })
                            }
                        }
                    }
                }
                // Bildschirmkoordinate
                var anchorPoint = getAnchorOfElement(currentFieldId);
                var lineToMapPos = null;
                // eine linie wird erstellt. diese linie verbindet das element und die position in der karte
                // else-fall: wurde keine position in der karte ausgwählt, dann besitzt jedes element seine ursprünglliche positin in der karte.
                if ($scope.map.lastClick) lineToMapPos = L.latLng($scope.map.lastClick.lat, $scope.map.lastClick.lng);
                else lineToMapPos = L.latLng(linesArray[currentFieldId][3].lat, linesArray[currentFieldId][3].lng);
                // es wird überprüft ob eine summenklammer erstellt werden kann. die position des elementes mit dem die verbindung erstellt werden soll wird zurückgeliefert
                var neighbourPos = $scope.checkCreateSummarize([currentFieldId - 1, currentFieldId + 1], currentFieldId, lineToMapPos);
                // wenn es kein passendes element gibt, dann einfach eine linie vom element bis zur karte gezeichnet
                if (!neighbourPos) {
                    if ($scope.map.lastClick) linesArray[currentFieldId] = [$scope.map.lastClick, anchorPoint, null, $scope.map.lastClick];
                    // wurde keine position in der karte ausgwählt, dann besitzt jedes element seine ursprünglliche positin in der karte.
                    else linesArray[currentFieldId] = [linesArray[currentFieldId][3], anchorPoint, null, linesArray[currentFieldId][3]];
                    // Eine Summenklammer mit dem gefundenen Element wird erstellt.
                } else linesArray[currentFieldId] = [linesArray[neighbourPos][1], anchorPoint, neighbourPos, linesArray[neighbourPos][3]];

                fitAllLines(linesArray);
                $scope.fields.currentField.active = true;
                $scope.map.lastClick = null;
                elements.shift();
                if (elements.length > 0) $scope.fields.addLine(elements);
            }
        };
        // Eine Summenklammer darf nur mit dem direkten nachbarn erstellt werden.
        // In der variablen fieldIdsArray sind die positionen der beiden nachbarn gespeichert
        $scope.checkCreateSummarize = function(fieldIdsArray, currentFieldId, lineToMapPos) {
            var casketSameRegion = false;
            var fieldId = null;
            var shortestDist = null;
            var tmpDist = null;
            var neighbourPos = null;
            for(var i = 0; i < fieldIdsArray.length; i++) {
                fieldId = fieldIdsArray[i];
                // top / right / bottom / left - erklären
                // Nur Elemente auf der gleiche Ebene dürfen miteinader verbunden werden
                if (fieldId <= 24 && currentFieldId <= 24) casketSameRegion = true;
                else if (fieldId >= 47 && currentFieldId >= 47) casketSameRegion = true;
                else if (fieldId <= 39 && currentFieldId <= 39) casketSameRegion = true;
                else if (fieldId >= 41 && currentFieldId >= 41) casketSameRegion = true;
                if (casketSameRegion && linesArray[fieldId]) {
                    // jedes element besitzt seine ursprüngliche position in der karte. anhand dieser position wird eine distanz berechnet. zwischen dem bestehenden element und dem neuen element.
                    if (linesArray[fieldId][3]) tmpDist = lineToMapPos.distanceTo(L.latLng(linesArray[fieldId][3].lat, linesArray[fieldId][3].lng));
                    // ist die distanz kleiner als 50 meter dann kann eine summenklammer erstellt werden
                    if (tmpDist <= 50 && (shortestDist == null || tmpDist < shortestDist)) {
                        // wenn das element einen vater hat, dann wird dessen id benötigt
                        if (linesArray[fieldId][2]) neighbourPos = linesArray[fieldId][2];
                        else neighbourPos = fieldId;
                        shortestDist = tmpDist;
                    }
                }
            }
            return neighbourPos;
        };

        $scope.fields.deleteLastLine = function(oldId){
            if (oldId) {
                var _oldField = document.getElementById(oldId).innerHTML;
                var _oldSplitted = _oldField.split("polygon");
                if (_oldSplitted.length > 1){
                    linesArray[oldId] = null;
                    fitAllLines(linesArray);
                }
            }
        };

        /********************************
         ************** Map **************
         ********************************/

        initMap();
        var itemDrawed = false; //ignore setting last click for tz line if last click was for drawing
        map.on('click', function(e){
            if(!itemDrawed){
                $scope.map.lastClick = e.latlng;
                $scope.fields.updateLine();
            }
            else{
                $scope.map.lastClick = null;
                itemDrawed = false;
            }
        });
        map.on('move', function(){
            fitAllLines(linesArray);
        });
        map.on('draw:drawstop', function(){});

        map.on('draw:drawstart', function(){});

        map.on('draw:created', function (e) {
            var type = e.layerType,
                layer = e.layer;
            var id = drawnItems.getLayerId(layer);
            layer.on('click', function(){$scope.map.objectClicked(type, layer, id)});
            $scope.map.lastClick = null;
            itemDrawed = true;
            drawnItems.addLayer(layer);
        });

        $scope.map = {};
        $scope.map.frozen = false;
        $scope.map.lastClick = null;
        $scope.map.objectId = null;
        $scope.hideColorPicker = false;

        $scope.map.objectClicked = function(type, layer, id){
            var tmpObj = {
                objectData: '',
                hideColorPicker: false,
                colour: '',
                dashed: '',
                comment: ''
            };
            $scope.map.objectId = id;
            if (!$scope.map.editActive){
                drawnItems.eachLayer(function(layer) {
                    setClickable(layer, false);
                });

                // hide colorPicker if the selected object is a marker
                if(type == "marker" || type.toLowerCase() == "point") {
                    tmpObj.hideColorPicker = true;
                }
                tmpObj.colour = drawnItems.getLayer($scope.map.objectId).options.color;
                tmpObj.dashed = drawnItems.getLayer($scope.map.objectId).options.dashArray;
                tmpObj.comment = commentsMap.get($scope.map.objectId);
                tmpObj.objectData = $scope.map.objects.getMeasurement(type, layer);
                windowManager.sharedData.set('editObject', tmpObj);
                windowManager.bridge.emit('loadEditObject');
            }
        };

        $scope.map.zoomIn = function(){
            if (!$scope.map.frozen) {map.zoomIn();}
        };
        $scope.map.zoomOut = function(){
            if (!$scope.map.frozen) {map.zoomOut();}
        };
        $scope.map.freeze = function(){
            if($scope.map.frozen){
                $scope.map.frozen = false;
                map.dragging.enable();
                map.scrollWheelZoom.enable();
                map.touchZoom.enable();
                map.doubleClickZoom.enable();
                map.boxZoom.enable();
                map.keyboard.enable();
                $("#map").css('cursor', '');
                $("#freezeMapLock").css('display', 'none');
                $("#freezeMap").css('color', 'black');
                $(".customZoomControl").css('color', 'black');
            }
            else {
                $scope.map.frozen = true;
                map.dragging.disable();
                map.scrollWheelZoom.disable();
                map.touchZoom.disable();
                map.doubleClickZoom.disable();
                map.boxZoom.disable();
                map.keyboard.disable();
                $("#map").css('cursor', 'default');
                $("#freezeMapLock").css('display', 'block');
                $("#freezeMap").css('color', 'grey');
                $(".customZoomControl").css('color', '#ddd');
            }
        };

        /************** Map Layers ************/
        $scope.map.initBasemaps = function(){
            $scope.map.showBasemap('http://www.wms.nrw.de/geobasis/wms_nw_dtk', 'nw_dtk_col');
        };

        $scope.map.showBasemap = function(wms, layer){
            var wmsLayer = null;
            if (layer === 'OpenStreetMap') {
                wmsLayer =  L.tileLayer(wms, {
                    attribution: '&copy; <a href="http://osm.org/copyright">' + layer + '</a> contributors'
                });
            } else {
                wmsLayer = L.tileLayer.wms(wms, {
                    layers: layer,
                    format: 'image/png',
                    transparent: false,
                    attribution: '&copy; geobasis.nrw 2016'
                });
            }
            basemap.clearLayers();
            basemap.addLayer(wmsLayer);
        };

        /************** Map draw ************/

        $scope.map.editActive = false;
        $scope.map.currentEdit = "";

        $scope.map.draw = function(type){
            $scope.fields.cancel();
            var _className = 'leaflet-draw-draw-' + type;
            var _element = document.getElementsByClassName(_className);
            _element[0].click();
        };

        $scope.map.deleteObjects = function(){
            var i = 0;
            drawnItems.eachLayer(function(layer) {
                console.log(i++);
                console.log(layer);
                setClickable(layer, true);
            });

            $scope.map.editActive = true;
            $scope.map.currentEdit = "leaflet-draw-actions leaflet-draw-actions-bottom";
            var _element = document.getElementsByClassName("leaflet-draw-edit-remove");
            _element[0].click();
        };

        $scope.map.editObjects = function(){
            $scope.map.editActive = true;
            $scope.map.currentEdit = "leaflet-draw-actions leaflet-draw-actions-top";
            var _element = document.getElementsByClassName("leaflet-draw-edit-edit");
            _element[0].click();
            $scope.map.objectId = "";
        };

        $scope.map.activateDrawInformation = function(){
            drawnItems.eachLayer(function(layer) {
                setClickable(layer, true);
            });
        };

        $scope.map.objects = {};
        $scope.map.objects.measureString = "";
        $scope.map.objects.type = "";
        $scope.map.objects.comment = "";

        // save a comment for a drawn object using a map (first value: ObjectId from leafletDraw, second value: commentText)
        $scope.map.saveComment = function(){
            commentsMap.set($scope.map.objectId, $scope.map.objects.comment);
        };

        $scope.map.showComment = function(){
            if ($scope.sideContent.template.includes('_drawnObject')) $scope.setColorPicker();

            $scope.map.objects.comment = commentsMap.get($scope.map.objectId);
            $scope.sideContent.change("app/templates/fgis/_drawnObject.html");
        };

        $scope.map.editCancel = function(){
            drawnItems.eachLayer(function(layer) {
                setClickable(layer, false);
            });
            $("#map").css('cursor', 'auto');
            $scope.map.editActive = false;
            var _element = document.getElementsByClassName($scope.map.currentEdit);
            if (_element.length > 0) _element[0].children[1].children[0].click();
            $scope.map.objectId = "";
        };

        $scope.map.editSave = function(){
            drawnItems.eachLayer(function(layer) {
                setClickable(layer, false);
            });
            $("#map").css('cursor', 'auto');
            $scope.map.editActive = false;
            var _element = document.getElementsByClassName($scope.map.currentEdit);
            if (_element.length > 0) {
                _element[0].children[0].children[0].click();
            }
            $scope.map.objectId = "";
            commentsMap.delete($scope.map.objectId);
        };

        // change the color of the choosen object
        $scope.map.changeGeomStyle = function(geomOptions) {
            commentsMap.set($scope.map.objectId, geomOptions.comment);
            drawnItems.getLayer($scope.map.objectId).setStyle({color: geomOptions.colour, dashArray: geomOptions.dash});
        };

        $scope.map.objects.getMeasurement = function(type, layer){
            var _htmlString = "";
            var _area = null;
            var _length = null;
            var _latlng = null;
            var _radius = null;
            var _type = "";

            // type can be a leaflet type, or a GeoJSON type, so we have to catch both
            switch (type.toLowerCase()) {
                case "rectangle":
                    _latlng = layer.getLatLngs();
                    _type = "<h4>Typ: Rechteck</h4>";
                    _area = L.GeometryUtil.geodesicArea(_latlng);
                    break;
                case "polygon":
                    _latlng = layer.getLatLngs();
                    _type = "<h4>Typ: Polygon</h4>";
                    _area = L.GeometryUtil.geodesicArea(_latlng);
                    break;
                case "circle":
                    _latlng = layer.getLatLng();
                    _radius = layer.getRadius();
                    _type = "<h4>Typ: Kreis</h4>";
                    _area = Math.PI * _radius * _radius;
                    break;
                case "polyline":
                case "linestring":
                    _latlng = layer.getLatLngs();
                    _type = "<h4>Typ: Polylinie</h4>";
                    _length = L.GeometryUtil.accumulatedLengths(_latlng);
                    _length = _length[_length.length-1];
                    break;
                case "marker":
                case "point":
                    _latlng = layer.getLatLng();
                    _type = "<h4>Typ: Punkt</h4>";
                    break;
            }

            if (_area != null) {
                if (_area < 1000000){
                    _htmlString = "<h4>Fläche: " + Math.floor(_area) + "<sup>2</sup><br> / " + Math.floor(_area/100)/100 + "ha</h4>";
                } else {
                    _htmlString = "<h4>Fläche: " + Math.floor(_area/100)/100 + " / " + Math.floor(_area/10000)/100 + "km<sup>2</sup><br></h4>";
                }
            }
            if (_length != null) {
                if (_length < 10000){
                    _htmlString = "<h4>Länge: " + Math.floor(_length) + "m</h4>";
                } else {
                    _htmlString = "<h4>Länge: " + Math.floor(_length/100)/10 + "km</h4>";
                }
            }
            return _htmlString + _type;
        };


        /********* INIT **********/

        $scope.map.initBasemaps();

        /** load the einsatz which is specified in the URL hash, when the controller is fully initialized */
        $scope.$on('$viewContentLoaded', function(){
            var einsatzID = decodeURIComponent(window.location.hash).split('map/').pop();
            if (['', 'map'].indexOf(einsatzID) == -1) $scope.loadEinsatz(einsatzID);
        });
    });

function initMap(){
    map = L.map('map', {
        zoomControl: true
    }).setView([51.50, 7.6], 8);
    L.control.scale({
        position: 'bottomright',
        metric: true,
        imperial: false
    }).addTo(map);

    lines = L.layerGroup().addTo(map);
    basemap = L.layerGroup().addTo(map);
    drawnItems = new L.FeatureGroup();
    map.addLayer(drawnItems);

    var drawOptions = {
        position: 'topright',
        draw: {
            polyline: {
                shapeOptions: { color: '#ff0000', clickable: false }
            },
            polygon: {
                allowIntersection: true,
                shapeOptions: { color: '#ff0000',  clickable: false },
                showArea: true
            },
            rectangle: {
                shapeOptions: { clickable: false,  color: '#ff0000' }
            },
            marker: {
                shapeOptions: { clickable: false } // doesn´t work, leaflet draw bug
            },
            circle: {
                shapeOptions: { color: '#ff0000', clickable: false }
            }
        },
        edit: {
            featureGroup: drawnItems, //REQUIRED!!
            remove: true
        }
    };

    drawControl = new L.Control.Draw(drawOptions);
    map.addControl(drawControl);
}

/**
 * @desc calculates coordinates for the anchor point (centered to the TZ slot) of the lines to be drawn correctly on map
 * @param elementId: ID of html element for which anchor point will get calculated.
 * @return calculated coordinates
 */
function getAnchorOfElement(elementId){
    if (elementId) {
        var _this = $("#"+elementId);
        var _map = $("#map");
        var _mapTop = _map.offset().top;
        var _mapLeft = _map.offset().left;
        var _mapWidth = parseInt(_map.css('width'), 10);
        var _mapHeight = parseInt(_map.css('height'), 10);
        var offset = _this.offset();
        var width = _this.width();
        var height = _this.height();
        var centerX = offset.left + width / 2;
        var centerY = offset.top + height / 2;

        // left column:
        if(centerX < _mapLeft) return [2, centerY - _mapTop];
        //right column:
        else if (centerX > _mapLeft + _mapWidth - 1) return [offset.left - _mapLeft, centerY - _mapTop];
        //top row:
        else if (centerY < _mapTop + 1 ) return [centerX - _mapLeft, 2];
        // bottom row:
        else if (centerY > _mapTop + _mapHeight - 1) return [centerX - _mapLeft, offset.top - _mapTop];
    }
}

/**
 * @desc sets option 'clickable' for a leaflet layer to value
 */
function setClickable(target, value) {
    // ignore if marker, because of Leaflet.draw bug
    if (target instanceof L.Marker) return;

    if(value && !target.options.clickable) {
        target.options.clickable = true;
        L.Path.prototype._initEvents.call(target);
        target._path.removeAttribute('pointer-events');
    } else if(!value && target.options.clickable) {
        target.options.clickable = false;
        // undoing actions done in L.Path.prototype._initEvents
        L.DomUtil.removeClass(target._path, 'leaflet-clickable');
        L.DomEvent.off(target._container, 'click', target._onMouseClick);
        ['dblclick', 'mousedown', 'mouseover', 'mouseout', 'mousemove', 'contextmenu'].forEach(function(evt) {
            L.DomEvent.off(target._container, evt, target._fireMouseEvent);
        });
        target._path.setAttribute('pointer-events', target.options.pointerEvents || 'none');
    }

    //change cursor icon to 'help' if clickable is true
    if (value) $("#map").css('cursor', 'help');
    else       $("#map").css('cursor', 'auto');
}

//fuction to relocate all lines to their anchor-points
function fitAllLines(linesArray){
    lines.clearLayers();
    for (var i = linesArray.length - 1; i >= 0; i--) {
        try {
            var p1 = null;
            // Wenn das Element einem Vater zugeordnet ist, dann müssen die Koordinaten in LatLng umgewandelt werden
            if (linesArray[i][2] != null) p1 =  map.containerPointToLatLng(linesArray[i][0]);
            else p1 = linesArray[i][0];
            var p2 = map.containerPointToLatLng(linesArray[i][1]);
            var latlngs = [p1, p2];
            lines.addLayer(L.polyline(latlngs));
        } catch(e){
            // do nothing, because the linesArray will have holes
        }
    }
}

/****************************************
 ************ Drag and Drop **************
 *****************************************/

function drag(ev){
    var startId = ev.target.id.split("e");
    ev.dataTransfer.setData("text", startId[1]);
}

function allowDrop(ev) {
    ev.preventDefault();
}

/**
 * @desc    generates the html string for a field, identified by its kranzposition
 * @returns html string to be placed within the fields div
 * @example $('<div class="field" id="12"</div>').append(getFieldHtmlString('12'));
 */
function getFieldHtmlString(kranzposition, svgPath , comment, textTop, textBottom) {
    var _image = '';
    var _textTop = '<div id="fieldTextTop' + kranzposition
        + '" class="fieldText fieldTextTop" style="overflow:hidden" title="'
        + textTop + '" data-toggle="tooltip">' + textTop + '</div>';

    var _textBottom = '<div id="fieldTextBottom' + kranzposition
        + '" class="fieldText fieldTextBottom" style="overflow:hidden" title="'
        + textBottom + '" data-toggle="tooltip">' + textBottom + '</div>';

    var _comment = '<div id="fieldComment' + kranzposition + '" class="fieldComment">'
        + comment + '</div>';

    // insert TZ if a path is given, else create a "NA" polygon
    if (svgPath) {
        _image = '<img id="image' + kranzposition + '" draggable="true" ondragstart="drag(event)" src="'
            + svgPath + '" style="height:' + fieldOrder.size + '; width:' + fieldOrder.size
            + '; background-color: white; text-align: center;" />';
    } else {
        _image = '<svg id="image' +  kranzposition + '" viewBox="0 0 89 89" preserveAspectRatio="none" style="height:'
            + fieldOrder.size + '; width:' + fieldOrder.size
            + ';"><polygon points="2,2 88,2 88,88 2,88 2,2 2,22.5 88,22.5 88,67.5 2,67.5"/></svg>';
    }
    return _textTop + _textBottom + _comment + _image;
}