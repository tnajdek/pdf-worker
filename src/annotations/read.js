const { stringToPDFString } = require('../../pdf.js/build/lib/shared/util');
const { arrayColorToHex } = require('../color');
const { getRawPageView, getString, isValidNumber, getAnnotationID, isTransferable } = require('./common');

const utils = require('../utils');
const putils = require('../putils');

const NOTE_SIZE = 22;



exports.readRawAnnotations = function (structure) {
	let annotations = [];
	let rawPages = structure['/Root']['/Pages']['/Kids'];
	for (let pageIndex = 0; pageIndex < rawPages.length; pageIndex++) {
		let rawAnnots = rawPages[pageIndex] && rawPages[pageIndex]['/Annots'];
		if (!rawAnnots) continue;
		for (let rawAnnotIdx = 0; rawAnnotIdx < rawAnnots.length; rawAnnotIdx++) {
			let rawAnnot = rawAnnots[rawAnnotIdx];
			if (!rawAnnot) continue;
			let view = getRawPageView(rawPages[pageIndex]);
			let annotation = exports.readRawAnnotation(rawAnnot, pageIndex, view);
			if (annotation) {
				annotations.push(annotation);
			}
		}
	}

	return annotations;
};

function resizeAndFitRect(rect, width, height, view) {
	let point = [rect[0] + (rect[2] - rect[0]) / 2, rect[1] + (rect[3] - rect[1]) / 2];
	rect = [
		point[0] - NOTE_SIZE / 2,
		point[1] - NOTE_SIZE / 2,
		point[0] + NOTE_SIZE / 2,
		point[1] + NOTE_SIZE / 2
	];

	if (rect[0] < 0) {
		rect[0] = 0;
		rect[2] = width;
	}

	if (rect[1] < 0) {
		rect[1] = 0;
		rect[3] = height;
	}

	if (rect[2] > view[2]) {
		rect[0] = view[2] - width;
		rect[2] = view[2];
	}

	if (rect[3] > view[3]) {
		rect[1] = view[3] - height;
		rect[3] = view[3];
	}

	return rect;
}

exports.resizeAndFitRect = resizeAndFitRect;

exports.readRawAnnotation = function (rawAnnot, pageIndex, view) {
	let type = rawAnnot['/Subtype'];
	if (!type) {
		return null;
	}
	type = type.slice(1);
	if (!['Text', 'Highlight', 'Underline', 'Square', 'Ink'].includes(type)) {
		return null;
	}

	type = type.toLowerCase();
	if (type === 'underline') {
		type = 'highlight';
	}
	else if (type === 'text') {
		type = 'note';
	}
	else if (type === 'square') {
		type = 'image';
	}

	let annotation = {};
	annotation.type = type;

	let id = getAnnotationID(rawAnnot);
	if (id) {
		annotation.id = getAnnotationID(rawAnnot);
	}

	if (['image', 'ink'].includes(type) && !annotation.id) {
		return null;
	}

	if (['highlight', 'note', 'image'].includes(annotation.type)) {
		let rects;
		if (Array.isArray(rawAnnot['/QuadPoints'])
			&& rawAnnot['/QuadPoints'].length % 8 === 0
			&& rawAnnot['/QuadPoints'].every(x => isValidNumber(x))) {
			rects = utils.quadPointsToRects(rawAnnot['/QuadPoints']);
		}
		else if (Array.isArray(rawAnnot['/Rect'])
			&& rawAnnot['/Rect'].length % 4 === 0
			&& rawAnnot['/Rect'].every(x => isValidNumber(x))) {
			rects = [putils.normalizeRect(rawAnnot['/Rect'])];
		}
		else {
			return null;
		}

		if (annotation.type === 'note') {
			if (rects.length > 1) {
				return null;
			}
			rects = [resizeAndFitRect(rects[0], NOTE_SIZE, NOTE_SIZE, view)];
		}

		rects = rects.map(r => r.map(n => Math.round(n * 1000) / 1000));
		// Sort rects from page top to bottom, left to right
		rects.sort((a, b) => b[1] - a[1] || a[0] - b[0]);

		annotation.position = {
			pageIndex,
			rects
		};
	}
	// Ink annotation
	else {
		if (!(Array.isArray(rawAnnot['/InkList'])
			&& rawAnnot['/InkList'].every(path =>
				Array.isArray(path)
				&& path.length
				&& path.length % 2 === 0
				&& path.every(n => isValidNumber(n))
			)
			&& rawAnnot['/BS']
			&& isValidNumber(rawAnnot['/BS']['/W'])
		)) {
			return null;
		}

		let paths = rawAnnot['/InkList'].map(path => path.map(n => Math.round(n * 1000) / 1000));
		let width = Math.round(rawAnnot['/BS']['/W'] * 1000) / 1000;
		annotation.position = {
			pageIndex,
			paths,
			width
		};
	}

	annotation.dateModified = utils.pdfDateToIso(getString(rawAnnot['/M']));
	annotation.authorName = stringToPDFString(getString(rawAnnot['/Zotero:AuthorName']));
	annotation.comment = stringToPDFString(getString(rawAnnot['/Contents']));

	let colorArray = putils.getColorArray(rawAnnot['/C'] || rawAnnot['/IC']);
	let alpha = rawAnnot['/CA'];
	if (colorArray && alpha === parseFloat(alpha)) {
		// Make sure we aren't producing invisible annotations
		if (alpha < 0.1) {
			alpha = 0.1;
		}
		colorArray = colorArray.map(c => alpha * c + (1 - alpha) * 255);
	}
	annotation.color = arrayColorToHex(colorArray);

	annotation.tags = [];
	if (rawAnnot['/Zotero:Tags']) {
		try {
			let tags = JSON.parse(stringToPDFString(getString(rawAnnot['/Zotero:Tags'])));
			if (Array.isArray(tags) && !tags.find(x => typeof x !== 'string')) {
				annotation.tags = tags;
			}
		}
		catch (e) {
			console.log(e);
		}
	}

	annotation.transferable = isTransferable(rawAnnot);

	return annotation;
};
