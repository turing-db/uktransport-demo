# TuringDB UK public transport network

<img width="1966" height="1093" alt="Screenshot 2026-10-03 at 21 32 58" src="https://github.com/user-attachments/assets/f854b84b-aded-457e-a5f4-4bfe08e9ffd9" />

This app shows the entirety of the UK public transport network federated and interconnected
as one TuringDB graph for Britain. 

It includes seven modes of transport across the UK:
| Mode | Routes | Services |
|---|---|---|
| bus | 49,645 | 1,471,217 |
| rail | 6,659 | 125,227 |
| coach | 1,708 | 29,888 |
| metro | 1,204 | 52,582 |
| tram | 919 | 32,454 |
| ferry | 389 | 29,746 |
| aerial_lift | 2 | 1,016 |

The data is already included in the repo as CSV files in the data/ directory. It has been fetched from NapTAN from the Department for Transport, 
the Bus Open Data Service GTFS timetables and the National Rail feeds.

Every transport stop and every segment of transport across the UK is drawn on a map, with a journey planner,
operator networks and a chat assistant.

<img width="1966" height="1093" alt="image" src="https://github.com/user-attachments/assets/fb503bb1-c753-4f85-9208-15291c4d9c52" />

## How to run

Just run the run.sh script and it will take care of everything for you.

```bash
./run.sh
# http://<tailscale-ip>:8099/?m=uktransport when tailscale is up,
# http://127.0.0.1:8099/?m=uktransport otherwise
```

Pass `--local` to serve on 127.0.0.1 even when tailscale is up.

The run.sh script does:
* Check out the turingdb-ui-kit submodule
* Convert the data CSV files into a TuringDB graph
* Launch turingdb in the background
* Launch the Vite typescript app
