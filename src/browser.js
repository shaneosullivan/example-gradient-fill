(function () {
  const IMAGE_PATH = "./images/airplane.png";
  let selectedColours = ["#FF0000", "#FFFFFF"];

  function runExample() {
    const canvas = document.getElementById("canvas");
    const sourceOffscreenCanvas = document.getElementById("offscreenCanvas");
    const context = canvas.getContext("2d");

    // Create the offscreen canvas that will be sent to the Worker.
    // Note that, in order to do this, you can NEVER have called getContext('2d')
    // on this canvas, and after executing this line, you can never call getContext('2d')
    // ever again on the canvas.
    const offscreenCanvas = sourceOffscreenCanvas.transferControlToOffscreen();

    addFormListener();

    const { context: unchangingContext } = makeCanvas({
      height: canvas.height,
      width: canvas.width,
    });

    // Load the image into the canvas
    const img = new Image();

    img.onload = () => {
      context.drawImage(img, 0, 0);
      unchangingContext.drawImage(img, 0, 0);

      const sourceImageData = getSrcImageData();

      // Tell the Worker about the canvas, the source image and the selected colours
      worker.postMessage(
        {
          action: "setCanvas",
          canvas: offscreenCanvas,
          buffer: sourceImageData.data.buffer,
        },
        [sourceImageData.data.buffer, offscreenCanvas]
      );
    };
    img.src = IMAGE_PATH;

    function getSrcImageData() {
      return unchangingContext.getImageData(0, 0, canvas.width, canvas.height);
    }

    let isPointerDown = false;

    // Listen for when the user first touches the canvas.
    canvas.addEventListener(
      "pointerdown",
      (evt) => {
        isPointerDown = true;

        const { x, y } = getEventCoords(evt, canvas.getBoundingClientRect());

        worker.postMessage({
          action: "setFillSource",
          point: { x, y },
          colours: selectedColours,
        });
      },
      false
    );

    // When the user lifts the pointer, commit the drawing to the main canvas
    canvas.addEventListener(
      "pointerup",
      () => {
        isPointerDown = false;

        context.drawImage(sourceOffscreenCanvas, 0, 0);
      },
      false
    );

    canvas.addEventListener("pointermove", (evt) => {
      if (isPointerDown) {
        const { x, y } = getEventCoords(evt, canvas.getBoundingClientRect());
        worker.postMessage({
          action: "setFillDest",
          point: { x, y },
        });
      }
    });

    // Set up the worker
    const workerUrl = "./src/worker.js";
    let worker = new Worker(workerUrl);
  }

  function makeCanvas(size) {
    const tempCanvas = document.createElement("canvas");
    if (size) {
      tempCanvas.width = size.width;
      tempCanvas.height = size.height;
    }
    const tempContext = tempCanvas.getContext("2d");

    return { canvas: tempCanvas, context: tempContext };
  }

  function getEventCoords(evt, nodeRect) {
    let x, y;
    if (evt.touches && evt.touches.length > 0) {
      x = evt.touches[0].clientX;
      y = evt.touches[0].clientY;
    } else {
      x = evt.clientX;
      y = evt.clientY;
    }
    return { x: Math.round(x - nodeRect.x), y: Math.round(y - nodeRect.y) };
  }

  // https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Pixel_manipulation_with_canvas
  // function getColorIndexForCoord(x, y, width) {
  //   return y * (width * 4) + x * 4;
  // }

  const rainbowColours = [
    "#ff2929", // RED
    "#ff7a29", // ORANGE
    "#fad02e", // YELLOW
    "#bf7f35", // BROWN
    "#91fa49", // GREEN
    "#36d8b7", // TURQUOISE
    "#991ef9", // VIOLET
    "#3b8aff", // BLUE,
    "#ff5dcd", // PINK
  ];

  function addFormListener() {
    document.getElementById("colourForm").addEventListener("change", (evt) => {
      const colour = evt.target.value + "";
      selectedColours =
        colour.toLowerCase() === "rainbow"
          ? rainbowColours
          : [colour, "#FFFFFF"];
    });
  }

  window.addEventListener("load", runExample);
})();
