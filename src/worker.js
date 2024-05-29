/*
  This web worker is where all the filling and algorithmic stuff happens.
*/

// This onmessage function is how a web worker receives messages
// from the main UI thread.
onmessage = function (evt) {
  const workerData = evt.data;

  console.log("worker got message", workerData);
  switch (workerData.action) {
    case "setCanvas":
      // When the user first clicks, store the image data as it is then
      // and a reference to the OffscreenCanvas
      setCanvasAction(workerData);
      break;
    case "setFillSource":
      setFillSourceAction(workerData);
      break;
    case "setFillDest":
      setFillDestAction(workerData);
      break;
    default:
      console.error("Unknown action in paint worker", workerData);
  }
};

let gradientInfo = null;

function setCanvasAction(workerData) {
  const gradientCanvas = workerData.canvas;

  const buffer = workerData.buffer;

  // Set up the gradientInfo here to ensure that
  // isProcessingPoint is set to true immediately, in case the
  // user moves the pointer really quickly
  gradientInfo = {
    canvas: gradientCanvas,
    sourceBuffer: buffer,
    colours: null,
    rect: null,
    isProcessingPoint: false,
  };

  const gradientContext = gradientCanvas.getContext("2d");

  // For all subsequent gradient drawing operations, only draw
  // onto non-transparent pixels
  // @ts-ignore
  gradientContext.globalCompositeOperation = "source-in";
}

function setFillSourceAction(workerData) {
  const point = workerData.point;

  const colours = workerData.colours;

  const gradientCanvas = gradientInfo.canvas;
  const { height, width } = gradientCanvas;

  const destImgData = new ImageData(width, height);

  let minX = width,
    maxX = 0,
    minY = height,
    maxY = 0;

  const bufferArray = new Uint8ClampedArray(gradientInfo.sourceBuffer);

  // Do an initial fill with a solid colour so we can apply
  // a gradient to just that area after
  floodFill(
    null,
    bufferArray,
    width,
    height,
    point.x,
    point.y,
    "#000000", // Black
    {
      pixelCallback: (x, y) => {
        // Record the bounding box of the filled pixels
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      },
    },
    // This is the image data that will actually have the black colour filled in
    destImgData.data,
    5
  );

  gradientInfo.rect = {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
  gradientInfo.sourcePoint = point;
  gradientInfo.colours = colours;

  const gradientContext = gradientCanvas.getContext("2d");

  // @ts-ignore
  gradientContext.putImageData(destImgData, 0, 0);

  setGradient([point, point]);
}

function setFillDestAction(workerData) {
  const point = workerData.point;

  setGradient([gradientInfo.sourcePoint, point]);
}

function floodFill(
  foregroundRgba, // Uint8ClampedArray,
  userRgba, // Uint8ClampedArray,
  width, // number,
  height, // number,
  sourceX, // number,
  sourceY, // number,
  colour, // string,
  callbacks,
  //  {
  //   pixelCallback?: (
  //     pixelX: number,
  //     pixelY: number,
  //     pixels: Uint8ClampedArray
  //   ) => void;
  //   visitedCallback?: (visitedPixels: Uint8Array) => void;
  // },
  destRgba, // Uint8ClampedArray,
  matchThreshold = 5
) {
  if (sourceX > width || sourceY > height || sourceX < 0 || sourceY < 0) {
    console.error(
      `floodFill error: source coordinates (${sourceX}, ${sourceY}) are out of bounds for width ${width}, height ${height}`
    );
    return;
  }

  const { pixelCallback, visitedCallback } = callbacks || {};

  const shouldFillAlpha = !!foregroundRgba;

  const colourRgb = colourStringToRgb(colour, true);

  // Floodfill an RGBA image array of a given width and height
  // starting at (x, y) with a colour.

  const visitedPixels = new Uint8Array(width * height);
  const queue = new Int32Array(2 * width * height);

  const rgbaToRead = foregroundRgba || userRgba;
  const rgbaToWrite = destRgba || userRgba;

  const sourceIdx = getColourIndexForCoord(sourceX, sourceY, width);

  let sourceA = rgbaToRead[sourceIdx + 3];
  let sourceR = rgbaToRead[sourceIdx];
  let sourceG = rgbaToRead[sourceIdx + 1];
  let sourceB = rgbaToRead[sourceIdx + 2];

  if (shouldFillAlpha && sourceA < ALPHA_THRESHOLD) {
    // Translate to white
    sourceA = sourceR = sourceG = sourceB = 255;
  }

  // Match colours close to the original. This allows for the slight
  // variations in colour that result from the Canvas applying slight
  // colour changes when drawing an arc or circle.
  const threshold = matchThreshold;

  // Do a first pass through the entire image, and for any colour that
  // is not close enough to the source colour, mark it as visited
  // so that we do not set it's colour later
  for (let i = 0; i < width * height; i++) {
    const i4 = i * 4;
    let r = rgbaToRead[i4];
    let g = rgbaToRead[i4 + 1];
    let b = rgbaToRead[i4 + 2];
    let a = rgbaToRead[i4 + 3];

    if (shouldFillAlpha) {
      if (a < ALPHA_THRESHOLD) {
        a = r = g = b = 255;
      } else if (r === b && b === g && r * (255 / a) > 180) {
        a = r = g = b = 255;
      }
    }

    const colourMatch =
      Math.abs(r - sourceR) < threshold &&
      Math.abs(g - sourceG) < threshold &&
      Math.abs(b - sourceB) < threshold &&
      Math.abs(a - sourceA) < threshold;

    visitedPixels[i] = !colourMatch ? 1 : 0;

    // Uncomment this if using the /debug page and you want to step
    // through every step of the pixel visitation stuff
    // if (visitedCallback && visitedPixels[i]) {
    //   visitedCallback(visitedPixels);
    // }
  }

  // Add initial pixel to queue
  let n = 0;
  queue[n++] = sourceX;
  queue[n++] = sourceY;

  // Mark initial pixel as visited
  const initPos = sourceX + sourceY * width;
  const initPos4 = initPos * 4;

  visitedPixels[initPos] = 1;

  const colourAlpha = colourRgb.length < 4 ? 255 : colourRgb[3];

  // Set the first matching pixel in the output buffer to the original colour
  rgbaToWrite[initPos4 + 0] = colourRgb[0];
  rgbaToWrite[initPos4 + 1] = colourRgb[1];
  rgbaToWrite[initPos4 + 2] = colourRgb[2];
  rgbaToWrite[initPos4 + 3] = colourAlpha;

  pixelCallback && pixelCallback(sourceX, sourceY, rgbaToWrite);

  // While we have not processed all pixels yet, pop one off the queue
  // and process it
  while (n > 0) {
    // Pop pixel from queue
    const currentY = queue[--n];
    const currentX = queue[--n];

    // Scan to the left until we either find
    // - a matching colour
    // - a pixel we've already looked at
    // - the edge of the image
    let x1 = currentX;
    while (x1 > 0 && !visitedPixels[x1 - 1 + currentY * width]) {
      x1--;
    }

    // Scan to the right until we either find
    // - a matching colour
    // - a pixel we've already looked at
    // - the edge of the image
    let x2 = currentX;
    while (x2 < width - 1 && !visitedPixels[x2 + 1 + currentY * width]) {
      x2++;
    }

    // For the pixels in the current horizontal line that we need to visit
    // - Mark them as visited
    // - Set their colour to the users colour
    for (let x = x1; x <= x2; x++) {
      const xi = x + currentY * width;
      const xi4 = xi * 4;

      // Mark all pixels in scan line as visited
      visitedPixels[xi] = 1;

      rgbaToWrite[xi4] = colourRgb[0];
      rgbaToWrite[xi4 + 1] = colourRgb[1];
      rgbaToWrite[xi4 + 2] = colourRgb[2];
      rgbaToWrite[xi4 + 3] = colourAlpha;

      pixelCallback && pixelCallback(x, currentY, rgbaToWrite);
    }

    // Add pixels above scan line to queue
    if (currentY + 1 < height) {
      for (let x = x1; x <= x2; x++) {
        const xi = x + (currentY + 1) * width;
        if (!visitedPixels[xi]) {
          visitedPixels[xi] = 1;
          queue[n++] = x;
          queue[n++] = currentY + 1;
        }
      }
    }

    // Add pixels below scan line to queue
    if (currentY > 0) {
      for (let x = x1; x <= x2; x++) {
        const xi = x + (currentY - 1) * width;
        if (!visitedPixels[xi]) {
          visitedPixels[xi] = 1;
          queue[n++] = x;
          queue[n++] = currentY - 1;
        }
      }
    }
  }
}

function setGradient(points) {
  gradientInfo.isProcessingPoint = true;

  const { height, width } = gradientInfo.canvas;
  const { rect } = gradientInfo;

  const angle =
    points[0].x === points[1].x && points[0].y === points[1].y
      ? 90
      : calculateAngleDeg(points[0], points[1]);

  const dist = getDist(points[0].x, points[0].y, points[1].x, points[1].y);

  const percentIncrease =
    1 + (dist > 0 ? (dist * 2) / Math.max(height, width) : 0);

  let newHeight = rect.height * percentIncrease;
  let newWidth = rect.width * percentIncrease;
  let newX = rect.x - (newWidth - rect.width) / 2;
  let newY = rect.y - (newHeight - rect.height) / 2;

  const biggerRect = {
    height: newHeight,
    width: newWidth,
    x: newX,
    y: newY,
  };

  fillCanvasWithGradient(
    gradientInfo.canvas,
    gradientInfo.colours,
    angle,
    biggerRect
  );

  gradientInfo.isProcessingPoint = false;
}

function fillCanvasWithGradient(
  canvas, // HTMLCanvasElement | OffscreenCanvas,
  colours, // string[],
  angle, // number,
  rect // Rect
) {
  if (colours.length < 2) {
    throw new Error("At least two colors are required to create a gradient.");
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to get canvas context.");
  }

  const { width, height } = rect;

  // Convert the angle to radians and calculate the direction vector
  const radians = (angle * Math.PI) / 180;
  const x = Math.cos(radians);
  const y = Math.sin(radians);

  // Determine the gradient start and end points based on the rectangle size and angle
  const x0 = rect.x + (width / 2) * (1 - x);
  const y0 = rect.y + (height / 2) * (1 - y);
  const x1 = rect.x + (width / 2) * (1 + x);
  const y1 = rect.y + (height / 2) * (1 + y);

  // @ts-ignore
  const gradient = ctx.createLinearGradient(x0, y0, x1, y1);

  // Distribute color stops evenly
  colours.forEach((color, index) => {
    const stopPosition = index / (colours.length - 1);
    gradient.addColorStop(stopPosition, color);
  });

  // Fill the specified rectangular area with the gradient
  // @ts-ignore
  ctx.fillStyle = gradient;
  // @ts-ignore
  ctx.fillRect(rect.x, rect.y, width, height);
}

function colourStringToRgb(colour) {
  if (colour.indexOf("rgba(") === 0) {
    return colour
      .slice(5)
      .split(")")[0]
      .split(",")
      .map((numStr) => {
        return strToNum(numStr.trim());
      })
      .slice(0, 3);
  } else if (colour.indexOf("rgb(") === 0) {
    return colour
      .slice(4)
      .split(")")[0]
      .split(",")
      .map((numStr) => {
        return strToNum(numStr.trim());
      })
      .slice(0, 3);
  } else if (colour.indexOf("#") === 0) {
    return hexToRgb(colour);
  }
  return null;
}

function hexToRgb(hex) {
  const normal = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (normal) {
    return normal.slice(1).map((e) => parseInt(e, 16));
  }

  const shorthand = hex.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  if (shorthand) {
    return shorthand.slice(1).map((e) => 0x11 * parseInt(e, 16));
  }

  return null;
}

function strToNum(str) {
  if (str === null || str === undefined) {
    return str;
  }
  let strVal = str;
  if (Array.isArray(str)) {
    strVal = str[0];
  }
  if (typeof strVal === "string") {
    if (strVal.trim().length === 0) {
      return 0;
    }
    return parseFloat(strVal);
  }
  return strVal;
}

// https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Pixel_manipulation_with_canvas
function getColourIndexForCoord(x, y, width) {
  return y * (width * 4) + x * 4;
}

function getDist(
  x1, // number,
  y1, // number,
  x2, // number,
  y2 // number
) {
  let deltaX = x1 - x2;
  let deltaY = y1 - y2;
  return Math.floor(Math.sqrt(deltaX * deltaX + deltaY * deltaY));
}

function calculateAngleDeg(pt1, pt2) {
  const radians = calculateAngleRad(pt1, pt2);
  const angleDeg = (radians * 180) / Math.PI;
  // Ensure the angle is positive (between 0 and 360 degrees)
  const positiveAngle = (angleDeg + 360) % 360;
  return positiveAngle;
}

function calculateAngleRad(pt1, pt2) {
  return Math.atan2(pt2.y - pt1.y, pt2.x - pt1.x);
}
