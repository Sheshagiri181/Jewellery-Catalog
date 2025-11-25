/* script.js
   Frontend <-> Backend glue for index.html and details.html
*/

// helper
function qs(sel) { return document.querySelector(sel); }

(function() {
    const path = window.location.pathname;
    if (path === "/" || path.endsWith("index.html")) {
        // INDEX PAGE behavior
        const uploadInput = qs("#uploadInput") || qs("input[type=file]");

        if (!uploadInput) {
            console.warn("No upload input found on index page");
        } else {
            uploadInput.addEventListener("change", async function (e) {
                const file = this.files[0];
                if (!file) return;

                // create a preview dataURL to show locally on details page
                const reader = new FileReader();
                reader.onload = async function(ev) {
                    try {
                        localStorage.setItem("uploadedImage", ev.target.result); // preview
                    } catch (err) {
                        console.warn("Could not store preview in localStorage:", err);
                    }

                    // Upload to backend /match
                    const form = new FormData();
                    form.append("image", file);

                    const originalLabel = document.querySelector(".upload-box");
                    if (originalLabel) { originalLabel.textContent = "Uploading & Matching..."; originalLabel.style.pointerEvents = "none"; }

                    try {
                        const res = await fetch("/match", {
                            method: "POST",
                            body: form
                        });

                        if (!res.ok) {
                            const text = await res.text();
                            throw new Error(`Server error: ${res.status} - ${text}`);
                        }

                        const data = await res.json();

                        if (!data || !data.results) {
                            throw new Error("Unexpected response from server");
                        }

                        // save results (stringified)
                        localStorage.setItem("matchResults", JSON.stringify(data.results));

                        // navigate to details page
                        window.location.href = "/details";
                    } catch (err) {
                        console.error("Upload/match failed:", err);
                        alert("Failed to upload or match image. See console for details.");
                        if (originalLabel) { originalLabel.textContent = "Click here to upload jewelry image"; originalLabel.style.pointerEvents = ""; }
                    }
                };
                reader.readAsDataURL(file);
            });
        }
    } else if (path.endsWith("details") || path.endsWith("details.html")) {
        // DETAILS PAGE behavior
        window.addEventListener("DOMContentLoaded", () => {
            const uploadedDataURL = localStorage.getItem("uploadedImage");
            const resultsJSON = localStorage.getItem("matchResults");

            const uploadedImgEl = document.getElementById("uploadedImage");
            const detailsArea = document.getElementById("detailsArea");
            const top5Container = document.getElementById("top5Container");

            if (uploadedDataURL && uploadedImgEl) {
                uploadedImgEl.src = uploadedDataURL;
            }

            if (!resultsJSON) {
                if (detailsArea) detailsArea.innerHTML = "<div class='detail-row'>No match results found. Try uploading an image first.</div>";
                return;
            }

            let results;
            try {
                results = JSON.parse(resultsJSON);
            } catch (err) {
                console.error("Invalid matchResults JSON:", err);
                if (detailsArea) detailsArea.innerHTML = "<div class='detail-row'>Unable to read saved results.</div>";
                return;
            }

            if (!Array.isArray(results) || results.length === 0) {
                if (detailsArea) detailsArea.innerHTML = "<div class='detail-row'>No matching items returned by server.</div>";
                return;
            }

            // show the best (first) result by default
            const best = results[0];

            function renderDetails(item) {
                const det = item.details || {};
                const score = (typeof item.score === "number") ? item.score.toFixed(4) : item.score;

                const detailsHtml = `
                    <div class="detail-row"><b>Style No:</b> ${det.Style_No || det.style_no || extractStyleFromPath(item.image_path) || "N/A"}</div>
                    <div class="detail-row"><b>Category:</b> ${det.Category || det.category || "N/A"}</div>
                    <div class="detail-row"><b>Kt:</b> ${det.Kt || det.kt || det.K || "N/A"}</div>
                    <div class="detail-row"><b>Net Gold:</b> ${det.Net_Gold || det.net_gold || "N/A"}</div>
                    <div class="detail-row"><b>Shape:</b> ${det.Shape || det.shape || "N/A"}</div>
                    <div class="detail-row"><b>Diamond Wt:</b> ${det.Dia_Wt_C || det.Dia_Wt || det.diamond_wt || "N/A"}</div>
                    <div class="detail-row"><b>Stone Qty:</b> ${det.Stone_Qty || det.stone_qty || det.StoneQty || "N/A"}</div>
                    <div class="detail-row"><b>Score:</b> ${score}</div>
                `;
                if (detailsArea) detailsArea.innerHTML = detailsHtml;

                // set main image from server (if available)
                if (uploadedImgEl && item.image_path) {
                    const serverUrl = `/dataset_images/${encodeURIComponent(item.image_path)}`;
                    uploadedImgEl.src = serverUrl;
                    uploadedImgEl.onerror = function() {
                        if (uploadedDataURL) uploadedImgEl.src = uploadedDataURL;
                    };
                }
            }

            function extractStyleFromPath(p) {
                if (!p) return null;
                const name = p.split("/").pop();
                return name ? name.split(".")[0] : null;
            }

            // render best
            renderDetails(best);

            // render top5 thumbnails
            if (top5Container) {
                top5Container.innerHTML = "";
                results.slice(0, 5).forEach((item, idx) => {
                    const img = document.createElement("img");
                    img.src = `/dataset_images/${encodeURIComponent(item.image_path)}`;
                    img.alt = item.image_path || `match-${idx+1}`;
                    img.title = `Score: ${typeof item.score === "number" ? item.score.toFixed(4) : item.score}`;
                    img.style.cursor = "pointer";
                    img.addEventListener("click", () => {
                        renderDetails(item);
                        detailsArea.scrollIntoView({ behavior: "smooth", block: "start" });
                    });
                    img.onerror = function() {
                        this.onerror = null;
                        this.src = "https://via.placeholder.com/120";
                    };
                    top5Container.appendChild(img);
                });
            }
        });
    } else {
        console.log("script.js loaded on unknown page:", path);
    }
})();
